# Evaluation harness (paper §Experimental Setup)

All commands run from `agent/`.

## 1. Repeated trials of every scenario
Stack up as in `agent/README.md`, plus baseline traffic (`cd problem && npm run traffic -- --users 20`)
and the server (`uv run python -m aura.main`). Then:

```bash
uv run python -m eval.run_trials --trials 5                 # 10 scenarios × 5, round-robin
uv run python -m eval.summarize eval/results/trials-*.jsonl --latex ../paper/tables/trials.tex
```
Per trial: wait for a quiet, healthy baseline → inject → incident opened → first proposal (+ up to 90 s
for re-analysis if it was advisory) → score vs `answer_key.py` → approve if correct, else reject with
reason → wait for close (execution + verification) → `inject.js recover`. Approvals and rejections go
into memory, so later trials see earlier ones. For a cold-memory condition, wipe and reseed between runs
(`uv run python -m aura.memory.seed --reset`; plain `seed` only adds, it never removes learned memories). For no
memory at all, start both the server and `run_trials` with `AURA_MEMORY=off`. A full 50-trial run takes roughly 5–8 h and makes about 50+ LLM calls.

## 2. False-alarm rate on clean traffic (no LLM, no server)
```bash
uv run python -m eval.record --duration 90m --out eval/results/baseline-clean.jsonl
uv run python -m eval.replay --compare eval/results/baseline-clean.jsonl
```
The replay runs the *same* recording through the ladder naive 2σ → +4σ → +σ floor → +absolute floors →
+sustain (the default), so the profiles are compared on identical traffic. The profile is chosen by env
(`AURA_DETECTOR=naive`, `AURA_SIGMA`, `AURA_MIN_SD_FRAC`, `AURA_ABS_FLOORS`, `AURA_SUSTAIN`). Defaults are
unchanged. Also try `npm run traffic -- --profile flash-sale` recordings for a harder baseline.
