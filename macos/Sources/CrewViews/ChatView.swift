#if canImport(SwiftUI)
import CrewKit
import SwiftUI

public struct ChatScene {
    public var rows: [ChatRow]
    public var approvals: [ApprovalItem]
    public var draft: String
    public var error: String?
    public var hasOlder: Bool

    public init(rows: [ChatRow], approvals: [ApprovalItem] = [], draft: String = "", error: String? = nil, hasOlder: Bool = false) {
        self.rows = rows
        self.approvals = approvals
        self.draft = draft
        self.error = error
        self.hasOlder = hasOlder
    }
}

struct ChatView: View {
    let chat: ChatScene
    let card: PermissionCard?
    let actions: WindowActions
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let theme = Theme(scheme)
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if chat.hasOlder {
                            Button("Show earlier messages", action: actions.chatOlder)
                                .buttonStyle(.plain)
                                .font(.system(size: 11.5))
                                .foregroundStyle(theme(.subtext))
                                .frame(maxWidth: .infinity)
                        }
                        if chat.rows.isEmpty {
                            Text("No messages yet")
                                .font(.system(size: 12))
                                .foregroundStyle(theme(.subtext))
                                .frame(maxWidth: .infinity)
                        }
                        ForEach(chat.rows) { row in
                            rowView(row, theme)
                        }
                        ForEach(chat.approvals) { item in
                            approvalCard(item, theme)
                        }
                        if let card, !card.prompt.choices.isEmpty {
                            permissionCard(InlineApproval(prompt: card.prompt, agent: ""), theme)
                        }
                        Color.clear.frame(height: 1).id("chat-end")
                    }
                    .padding(.horizontal, 60)
                    .padding(.vertical, 24)
                }
                .onAppear { proxy.scrollTo("chat-end", anchor: .bottom) }
                .onChange(of: chat.rows.count) { proxy.scrollTo("chat-end", anchor: .bottom) }
            }
            if let error = chat.error {
                Text(error).font(.system(size: 11)).foregroundStyle(theme(.red)).padding(.horizontal, 60)
            }
            Rectangle().fill(theme(.surface)).frame(height: 1)
            composer(theme)
        }
        .background(theme(.base))
    }

    @ViewBuilder
    private func rowView(_ row: ChatRow, _ theme: Theme) -> some View {
        switch row {
        case let .owner(_, text):
            HStack {
                Spacer(minLength: 120)
                Text(text)
                    .font(.system(size: 13.5))
                    .textSelection(.enabled)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 5, topTrailingRadius: 16).fill(theme(.blue)))
                    .foregroundStyle(Color.white)
            }
        case let .agent(_, text):
            HStack(alignment: .bottom, spacing: 9) {
                Circle().fill(theme(.surface)).frame(width: 28, height: 28)
                    .overlay(Image(systemName: "sparkles").font(.system(size: 12)).foregroundStyle(theme(.subtext)))
                Text(text)
                    .font(.system(size: 13.5))
                    .textSelection(.enabled)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 5, bottomTrailingRadius: 16, topTrailingRadius: 16).fill(theme(.crust)))
                Spacer(minLength: 120)
            }
        case let .tool(_, mark, summary, failed):
            Text(mark + " " + summary)
                .font(Metrics.mono)
                .lineLimit(2)
                .foregroundStyle(failed ? theme(.red) : theme(.subtext))
                .padding(.horizontal, 11)
                .padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(theme(.mantle)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme(.surface), lineWidth: 0.5))
                .padding(.leading, 37)
        case let .note(_, text):
            Text(text)
                .font(.system(size: 11.5))
                .foregroundStyle(theme(.subtext))
                .frame(maxWidth: .infinity)
        case .handoff:
            HStack(spacing: 8) {
                Rectangle().fill(theme(.surface)).frame(height: 1)
                Text("Earlier conversation ended · handoff saved to memory")
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme(.subtext))
                    .fixedSize()
                Rectangle().fill(theme(.surface)).frame(height: 1)
            }
        }
    }

    private func cardFrame<Buttons: View>(_ title: String, _ command: String, _ theme: Theme, @ViewBuilder buttons: () -> Buttons) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(theme(.peach)).frame(width: 8, height: 8)
                Text(title).font(.system(size: 13, weight: .semibold))
                Spacer()
                Text("Needs you").font(.system(size: 11)).foregroundStyle(theme(.subtext))
            }
            Text(command)
                .font(Metrics.code)
                .lineLimit(4)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 6).fill(theme(.mantle)))
            HStack(spacing: 8) { buttons() }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(width: 460, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme(.base)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme(.peach).opacity(0.55), lineWidth: 1))
        .shadow(color: theme(.peach).opacity(0.12), radius: 7, y: 4)
        .padding(.leading, 37)
    }

    private func permissionCard(_ card: InlineApproval, _ theme: Theme) -> some View {
        cardFrame(card.title, card.command, theme) {
            if let deny = card.deny {
                Button("Deny") { actions.answer(deny) }
            }
            if let always = card.always {
                Button("Always Allow") { actions.answer(always) }
            }
            Spacer()
            if let allow = card.allow {
                Button("Allow") { actions.answer(allow) }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return, modifiers: [])
            }
        }
    }

    private func approvalCard(_ item: ApprovalItem, _ theme: Theme) -> some View {
        cardFrame(item.title, item.action.input.isEmpty ? item.action.tool : item.action.input, theme) {
            Button("Deny") { actions.decide(item.id, false) }
            Spacer()
            Button("Allow") { actions.decide(item.id, true) }
                .buttonStyle(.borderedProminent)
        }
    }

    private func composer(_ theme: Theme) -> some View {
        HStack(spacing: 8) {
            TextField("Message the agent…", text: Binding(get: { chat.draft }, set: actions.chatDraft))
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 16).stroke(theme(.grey).opacity(0.5), lineWidth: 0.5))
                .onSubmit(actions.chatSend)
            Button(action: actions.chatSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(theme(.blue)))
            }
            .buttonStyle(.plain)
            .disabled(chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 60)
        .padding(.top, 12)
        .padding(.bottom, 16)
    }
}
#endif
