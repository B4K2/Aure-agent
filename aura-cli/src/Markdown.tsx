// Minimal terminal markdown for chat answers: headings, bullets, **bold**, `code`. Anything else is plain text.
import { Box, Text } from 'ink';

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <Text key={i} bold>{p.slice(2, -2)}</Text>
      : p.startsWith('`') ? <Text key={i} color="yellow">{p.slice(1, -1)}</Text>
        : <Text key={i}>{p}</Text>);
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\n{3,}/g, '\n\n').trim().split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        const head = line.match(/^\s*#{1,6}\s+(.*)/);
        if (head) return <Text key={i} bold color="cyan">{inline(head[1].replace(/\*\*/g, ''))}</Text>;
        const bullet = line.match(/^(\s*)[-*•]\s+(.*)/);
        if (bullet) return <Text key={i}>{' '.repeat(Math.min(bullet[1].length, 4) + 1)}<Text dimColor>• </Text>{inline(bullet[2])}</Text>;
        return <Text key={i}>{line ? inline(line.trim()) : ' '}</Text>;
      })}
    </Box>
  );
}
