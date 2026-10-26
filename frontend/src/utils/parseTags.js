// "a, b,, c" -> ['a', 'b', 'c']. Empty entries are dropped because the API rejects empty tags.
export default function parseTags(input) {
  return (input || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}
