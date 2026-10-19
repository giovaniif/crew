import Foundation
import Observation

public struct TranscriptTool: Codable, Sendable, Equatable {
    public var name: String
    public var summary: String?
    public var status: String
}

public struct TranscriptMessage: Codable, Sendable, Equatable {
    public var id: String
    public var cursor: Int64
    public var turn: String?
    public var role: String
    public var text: String?
    public var tool: TranscriptTool?
    public var at: String

    var key: String { id.isEmpty ? "@\(cursor)" : id }
}

public struct TranscriptPageReply: Codable, Sendable, Equatable {
    @NullAsEmpty public var messages: [TranscriptMessage]
    public var before: Int64
}

public enum ChatRow: Sendable, Equatable, Identifiable {
    case owner(id: String, text: String)
    case agent(id: String, text: String)
    case tool(id: String, mark: String, summary: String, failed: Bool)
    case note(id: String, text: String)
    case handoff(id: String)

    public var id: String {
        switch self {
        case let .owner(id, _), let .agent(id, _), let .note(id, _), let .handoff(id): id
        case let .tool(id, _, _, _): id
        }
    }

    static func of(_ m: TranscriptMessage) -> ChatRow? {
        if let tool = m.tool {
            let mark = switch tool.status {
            case "running": "◐"
            case "failed": "✗"
            default: "✓"
            }
            let summary = (tool.summary ?? "").isEmpty ? tool.name : tool.summary ?? tool.name
            return .tool(id: m.key, mark: mark, summary: summary, failed: tool.status == "failed")
        }
        let text = (m.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        switch m.role {
        case "user": return .owner(id: m.key, text: text)
        case "assistant": return .agent(id: m.key, text: text)
        default: return .note(id: m.key, text: text)
        }
    }
}

public struct ChatLog: Sendable, Equatable {
    public private(set) var before: Int64 = 0
    private var earlier: [ChatRow] = []
    private var current: [TranscriptMessage] = []
    private var transcript: String?
    private var handoffs = 0

    public init() {}

    public var hasOlder: Bool { before > 0 }

    public var rows: [ChatRow] {
        earlier + current.compactMap(ChatRow.of)
    }

    public mutating func newest(_ page: TranscriptPageReply, transcript path: String) {
        if let old = transcript, old != path, !current.isEmpty {
            handoffs += 1
            earlier += current.compactMap(ChatRow.of) + [.handoff(id: "handoff-\(handoffs)")]
            current = []
        }
        if !path.isEmpty || transcript == nil { transcript = path }
        if current.isEmpty { before = page.before }
        for m in page.messages {
            if let i = current.firstIndex(where: { $0.key == m.key }) {
                current[i] = m
            } else {
                current.append(m)
            }
        }
        current.sort { $0.cursor < $1.cursor }
    }

    public mutating func older(_ page: TranscriptPageReply) {
        let known = Set(current.map(\.key))
        current = page.messages.filter { !known.contains($0.key) } + current
        current.sort { $0.cursor < $1.cursor }
        before = page.before
    }
}

public struct InlineApproval: Sendable, Equatable {
    public var title: String
    public var command: String
    public var deny: String?
    public var always: String?
    public var allow: String?

    public init(prompt: Prompt, agent: String) {
        title = (agent.isEmpty ? "The agent" : agent) + " wants to run a command"
        command = prompt.text
        allow = prompt.allow?.id
        always = prompt.always?.id
        deny = prompt.choices.dropFirst().last { $0.label.lowercased().hasPrefix("no") }?.id
    }
}

struct TranscriptPageParams: Encodable, Sendable {
    var session: String
    var before: Int64?
    var limit: Int
}

@MainActor
@Observable
public final class ChatModel {
    public static let interval: Duration = .seconds(2)
    public static let pageSize = 50
    public let session: String
    public private(set) var log = ChatLog()
    public private(set) var approvals: [ApprovalItem] = []
    public var draft = ""
    public var error: String?
    private let caller: Caller

    public init(session: String, caller: Caller) {
        self.session = session
        self.caller = caller
    }

    public func refresh(transcript: String) async {
        do {
            let page: TranscriptPageReply = try await caller.call("transcript.page", params: TranscriptPageParams(session: session, limit: Self.pageSize))
            log.newest(page, transcript: transcript)
        } catch {
            self.error = ReviewController.message(error)
            return
        }
        do {
            let pending: [ApprovalItem]? = try await caller.call("approval.list", params: EmptyParams())
            approvals = (pending ?? []).filter { $0.sessionID == session }
        } catch {
            approvals = []
        }
    }

    public func loadOlder() async {
        guard log.hasOlder else { return }
        do {
            let page: TranscriptPageReply = try await caller.call("transcript.page", params: TranscriptPageParams(session: session, before: log.before, limit: Self.pageSize))
            log.older(page)
        } catch {
            self.error = ReviewController.message(error)
        }
    }

    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        do {
            let _: SendReply = try await caller.call("session.send", params: SendParams(session: session, text: text))
            draft = ""
            error = nil
        } catch {
            self.error = ReviewController.message(error)
        }
    }

    public func decide(_ id: String, approve: Bool) async {
        do {
            let _: ApprovalItem = try await caller.call("approval.decide", params: ApprovalDecideParams(id: id, approve: approve))
            approvals.removeAll { $0.id == id }
        } catch {
            self.error = ReviewController.message(error)
        }
    }
}

public struct ChatPersona: Sendable, Equatable {
    public var name: String
    public var look: MateLook?
    public var state: FaceState

    public static func of(session: Session, board: MateBoard?) -> ChatPersona {
        let face = FaceState.of(state: session.state, ended: session.ended)
        guard let mate = session.mate?.name, !mate.isEmpty else {
            return ChatPersona(name: "The agent", look: nil, state: face)
        }
        let row = board?.mates.first { $0.name == mate }
        let paused = board?.stopped == true || row?.paused == true
        return ChatPersona(
            name: mate.prefix(1).uppercased() + mate.dropFirst(),
            look: MateLook.of(name: mate, avatar: row?.avatar, color: row?.color),
            state: paused ? .paused : face
        )
    }
}
