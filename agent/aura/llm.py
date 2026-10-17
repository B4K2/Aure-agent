"""Muse 1.3 over its OpenAI-compatible endpoint: structured RCA, phrasing, and tool-calling chat."""
import json
import logging
from functools import lru_cache
from pathlib import Path

from openai import OpenAI
from pydantic import ValidationError

from . import config
from .state import RCAOutput

log = logging.getLogger("aura.llm")
PROMPTS = Path(__file__).parent / "prompts"


@lru_cache(maxsize=1)
def client() -> OpenAI:
    return OpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY, timeout=90)


def prompt(name: str, version: str = "v1") -> str:
    """Versioned prompt templates (§7) — edit/A-B the files, not the code."""
    return (PROMPTS / f"{name}_{version}.md").read_text()


def _structured(messages: list[dict], schema_model, model: str):
    schema = {"name": schema_model.__name__, "strict": False, "schema": schema_model.model_json_schema()}
    try:
        r = client().chat.completions.create(model=model, messages=messages,
                                             response_format={"type": "json_schema", "json_schema": schema})
    except Exception as e:  # endpoint without json_schema support → plain JSON mode + schema in the prompt
        log.warning("json_schema response_format rejected (%s); falling back to json_object", e)
        msgs = messages + [{"role": "system", "content": "Respond with ONLY a JSON object matching this schema:\n"
                            + json.dumps(schema["schema"])}]
        r = client().chat.completions.create(model=model, messages=msgs, response_format={"type": "json_object"})
    return r.choices[0].message.content or ""


def generate_rca(context: str, version: str = "v1") -> tuple[RCAOutput | None, str]:
    """Returns (parsed, raw). None after two failed parses → caller falls back to investigate_further (§7)."""
    messages = [{"role": "system", "content": prompt("hypothesis", version)}, {"role": "user", "content": context}]
    raw = ""
    for attempt in range(2):
        try:
            raw = _structured(messages, RCAOutput, config.LLM_MODEL)
            return RCAOutput.model_validate_json(_strip_fences(raw)), raw
        except (ValidationError, ValueError) as e:
            log.warning("RCA parse failed (attempt %d): %s", attempt + 1, e)
            messages = messages + [{"role": "assistant", "content": raw},
                                   {"role": "user", "content": f"That did not validate: {e}. Return corrected JSON only."}]
        except Exception as e:
            log.error("RCA call failed (attempt %d): %s", attempt + 1, e)
            raw = str(e)
    return None, raw


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1].rsplit("```", 1)[0]
    return s


def summarize(text: str) -> str:
    """Summary Writer: phrasing only. Skipped unless a separate cheaper model is configured — on the
    reasoning model it costs ~25 s of detection-to-notification time for cosmetic gain."""
    if config.LLM_FAST_MODEL == config.LLM_MODEL:
        return ""
    try:
        r = client().chat.completions.create(model=config.LLM_FAST_MODEL, messages=[
            {"role": "system", "content": prompt("summary")}, {"role": "user", "content": text}])
        return (r.choices[0].message.content or "").strip()
    except Exception as e:
        log.warning("summary call failed: %s", e)
        return ""


def chat(messages: list[dict], tools: list[dict]):
    return client().chat.completions.create(model=config.LLM_MODEL, messages=messages, tools=tools).choices[0].message
