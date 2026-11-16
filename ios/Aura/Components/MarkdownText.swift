import SwiftUI

/// Renders the agent's Markdown: headings, bullet and numbered lists, block quotes, fenced code,
/// rules, and inline styles (bold, italic, `code`, links). Partial text while streaming renders fine.
struct MarkdownText: View {
    let text: String

    enum Block: Hashable {
        case heading(Int, String), paragraph(String), bullet(String, Int), numbered(String, String, Int)
        case quote(String), code(String), rule
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(Self.parse(text).enumerated()), id: \.offset) { _, b in view(b) }
        }
    }

    @ViewBuilder func view(_ b: Block) -> some View {
        switch b {
        case .heading(let l, let s):
            Text(inline(s)).font(l == 1 ? .title3.weight(.semibold) : l == 2 ? .headline : .subheadline.weight(.semibold))
                .padding(.top, 2)
        case .paragraph(let s):
            Text(inline(s))
        case .bullet(let s, let indent):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•").foregroundStyle(Theme.dim)
                Text(inline(s))
            }
            .padding(.leading, CGFloat(indent) * 14)
        case .numbered(let n, let s, let indent):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(n + ".").monospacedDigit().foregroundStyle(Theme.dim)
                Text(inline(s))
            }
            .padding(.leading, CGFloat(indent) * 14)
        case .quote(let s):
            Text(inline(s)).foregroundStyle(Theme.dim)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.faint).frame(width: 2) }
        case .code(let s):
            ScrollView(.horizontal) {
                Text(s).font(.mono(12)).padding(10)
            }
            .scrollIndicators(.hidden)
            .background(.white.opacity(0.07), in: .rect(cornerRadius: 10))
        case .rule:
            Divider().overlay(Theme.faint)
        }
    }

    func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }

    static func parse(_ text: String) -> [Block] {
        var out: [Block] = [], para: [String] = [], code: [String]? = nil
        func flush() { if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))); para = [] } }

        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let c = code { out.append(.code(c.joined(separator: "\n"))); code = nil }
                else { flush(); code = [] }
                continue
            }
            if code != nil { code!.append(raw); continue }
            let indent = (raw.prefix(while: { $0 == " " }).count) / 2
            if line.isEmpty { flush(); continue }
            if line.allSatisfy({ $0 == "-" || $0 == "*" || $0 == "_" }) && line.count >= 3 { flush(); out.append(.rule); continue }
            if let m = line.firstMatch(of: /^(#{1,6})\s+(.*)$/) {
                flush(); out.append(.heading(m.1.count, String(m.2))); continue
            }
            if let m = line.firstMatch(of: /^[-*+]\s+(.*)$/) {
                flush(); out.append(.bullet(String(m.1), indent)); continue
            }
            if let m = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush(); out.append(.numbered(String(m.1), String(m.2), indent)); continue
            }
            if line.hasPrefix(">") {
                flush(); out.append(.quote(line.dropFirst().trimmingCharacters(in: .whitespaces))); continue
            }
            para.append(line)
        }
        if let c = code { out.append(.code(c.joined(separator: "\n"))) }  // unterminated fence while streaming
        flush()
        return out
    }
}
