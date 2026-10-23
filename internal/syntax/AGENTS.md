# internal/syntax

The curated chroma lexers that `crew rpc` and `crew serve` use to highlight a diff (see [ADR 0049](../../docs/adr/0049-macos-app.md), "Review highlighting in Go").

- Lexers: chroma XML files in `lexers/` (MIT, `COPYING` kept), and Go and Markdown rules in Go. The package builds them on first use. Add a new language in `lexers/` as a chroma XML file. depguard bans the `lexers` and `styles` packages of chroma, because their init adds time to each `crew hook`.
- `Match(filename)` returns the lexer for a file name, or nil.
- `Spans(filename, lines)` tokenises the lines as one text. It returns `[start, end, class]` spans for each line. The spans use byte offsets in the line, and adjacent tokens of the same class are merged. The classes are a fixed set: `keyword`, `string`, `comment`, `number`, `function`, `type`, `operator`, `punctuation`. A file with no lexer, or a lexer that fails, gives nil. The TUI colours chroma token types itself (`internal/tui/highlight.go`). The class mapping is only for native clients.
- `ReviewSpans(result)` adds the `Spans` of each line to a `review.open` result. `crew rpc` (`internal/rpcpipe`) and `crew serve` use it when a client asks for tokens.
- Tests: `go test ./cmd/crew/ -run Tokens` pins the spans for Go, TypeScript and Markdown in `cmd/crew/testdata/review_tokens.json.golden`. To make it again, use `-update` and review the diff.
