import Foundation

public struct SessionMate: Codable, Sendable, Equatable {
    public var name: String
    public var local: Bool

    public init(name: String, local: Bool = false) {
        self.name = name
        self.local = local
    }

    enum CodingKeys: String, CodingKey {
        case name = "Name", local = "Local"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        local = try c.decodeIfPresent(Bool.self, forKey: .local) ?? false
    }
}

public struct MateMemory: Codable, Sendable, Equatable {
    public var name: String
    public var path: String
    public var text: String
    public var limit: Int

    public init(name: String, path: String, text: String, limit: Int) {
        self.name = name
        self.path = path
        self.text = text
        self.limit = limit
    }
}

public struct MemoryMeter: Sendable, Equatable {
    public var bytes: Int
    public var limit: Int

    public init(text: String, limit: Int) {
        bytes = text.utf8.count
        self.limit = max(limit, 1)
    }

    public var fraction: Double { min(1, Double(bytes) / Double(limit)) }

    public var full: Bool { bytes > limit }

    public var label: String {
        let cap = "\(limit / 1024) KB"
        switch bytes {
        case 0: return "Empty · \(cap) limit"
        case ..<1024: return "\(bytes) bytes of \(cap)"
        default:
            let tenths = (bytes * 10 + 512) / 1024
            return "\(tenths / 10).\(tenths % 10) KB of \(cap)"
        }
    }
}

public enum MemoryNotes {
    public static func notes(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).compactMap { raw in
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#") { return nil }
            if line.hasPrefix("- ") || line.hasPrefix("* ") { line = String(line.dropFirst(2)) }
            line = line.trimmingCharacters(in: .whitespaces)
            return line.isEmpty ? nil : line
        }
    }
}

public struct MateChat: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var `where`: String
    public var state: String
    public var status: String
    public var face: FaceState
}

public struct MateConversations: Sendable, Equatable {
    public var live: [MateChat]
    public var past: [MateChat]
    private var repos: [String: String]

    public init(state: ViewState, mate: String) {
        let mine = state.sortedSessions.filter { $0.mate?.name == mate } + state.sessions.filter { $0.ended && $0.mate?.name == mate }
        let worktrees = Dictionary(state.worktrees.map { ($0.id, $0.repo) }, uniquingKeysWith: { a, _ in a })
        var seen = Set<String>()
        var live: [MateChat] = []
        var past: [MateChat] = []
        var repos: [String: String] = [:]
        for s in mine where seen.insert(s.id).inserted {
            let item = MateChat(
                id: s.id, title: s.name, where: s.where, state: s.state,
                status: Self.status(s), face: FaceState.of(state: s.state, ended: s.ended)
            )
            if s.ended { past.append(item) } else { live.append(item) }
            repos[s.id] = s.worktreeIDs.compactMap { worktrees[$0] }.first ?? Self.repo(where: s.where)
        }
        self.live = live
        self.past = past
        self.repos = repos
    }

    public func repo(of session: String) -> String? {
        repos[session].flatMap { $0.isEmpty ? nil : $0 }
    }

    static func repo(where text: String) -> String {
        text.split(separator: "@").first.map(String.init) ?? ""
    }

    static func status(_ s: Session) -> String {
        if s.ended { return "Ended" }
        if StateStyle.needsYou(s.state) { return "Needs you" }
        switch s.state {
        case "running": return "Working"
        case "done": return "Done"
        default: return StateStyle(state: s.state).label
        }
    }
}

public struct MateStatusLine: Sendable, Equatable {
    public var state: String
    public var text: String
    public var face: FaceState

    public init(state: String, text: String, face: FaceState) {
        self.state = state
        self.text = text
        self.face = face
    }
}

public struct MateCard: Sendable, Equatable, Identifiable {
    public var name: String
    public var display: String
    public var look: MateLook
    public var agent: String
    public var tagline: String
    public var tones: [String]
    public var repos: [String]
    public var brains: String
    public var live: Int
    public var status: MateStatusLine

    public var id: String { name }

    public var liveLabel: String { live == 0 ? "No live chats" : "\(live) live" }

    public static func tagline(_ personality: String) -> String {
        let text = personality.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.components(separatedBy: "\n\n").first ?? text
    }

    public static func agentTitle(_ harness: String) -> String {
        switch harness {
        case "claude": "Claude"
        case "codex": "Codex"
        default: harness
        }
    }

    init(definition d: MateDefinition, state: ViewState?) {
        let conversations = state.map { MateConversations(state: $0, mate: d.name) }
        let live = conversations?.live ?? []
        name = d.name
        display = MateNames.display(d.name)
        look = MateLook.of(d)
        agent = d.agent
        tagline = Self.tagline(d.prompt)
        tones = MateTones(d.tone).chips
        repos = d.repos ?? []
        brains = ([Self.agentTitle(d.agent)] + [d.model, d.effort].compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · ")
        self.live = live.count
        if !d.enabled {
            status = MateStatusLine(state: "idle", text: "Paused", face: .paused)
        } else if let needs = live.first(where: { $0.face == .needs }) {
            status = MateStatusLine(state: needs.state, text: "Needs you", face: .needs)
        } else if let working = live.first(where: { $0.state == "running" }) {
            status = MateStatusLine(state: "running", text: "Working on " + working.title, face: .working)
        } else if let done = live.first(where: { $0.state == "done" }) {
            status = MateStatusLine(state: "done", text: "Finished " + done.title, face: .idle)
        } else {
            status = MateStatusLine(state: "idle", text: "Idle", face: .idle)
        }
    }
}

public enum MateFilter: Hashable, Sendable {
    case all
    case live
    case agent(String)
}

public struct MateGallery: Sendable, Equatable {
    public var cards: [MateCard]
    public var filter: MateFilter = .all
    public var search = ""

    public init(definitions: [MateDefinition], state: ViewState?) {
        cards = definitions.map { MateCard(definition: $0, state: state) }
    }

    public func matches(_ card: MateCard, _ filter: MateFilter) -> Bool {
        switch filter {
        case .all: true
        case .live: card.live > 0
        case let .agent(harness): card.agent == harness
        }
    }

    public func count(_ filter: MateFilter) -> Int {
        cards.filter { matches($0, filter) }.count
    }

    public var shown: [MateCard] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return cards.filter { card in
            matches(card, filter) && (query.isEmpty || [card.name, card.display, card.tagline].contains { $0.lowercased().contains(query) })
        }
    }

    public var liveTotal: Int { cards.reduce(0) { $0 + $1.live } }

    public var summary: String {
        "\(cards.count) mate\(cards.count == 1 ? "" : "s") · \(liveTotal) live"
    }
}

public struct MatesEntry: Sendable, Equatable {
    public var names: [String]
    public var live: Int

    public init(state: ViewState) {
        names = state.mates?.mates.map(\.name) ?? []
        live = state.sessions.filter { !$0.ended && $0.mate != nil }.count
    }

    public var label: String {
        names.isEmpty ? "Add a mate" : "\(names.count) · \(live) live"
    }
}

public enum StartFresh {
    public static let handoff = "Before we start fresh: write a short handoff to your memory file. Say what you did, what is left and the next step. Keep the file small. Then stop and wait."

    public static func offered(_ session: Session) -> Bool {
        session.mate != nil && !session.ended
    }

    public static func title(_ mate: String) -> String {
        "Start fresh with \(MateNames.display(mate))?"
    }

    public static func detail(_ mate: String) -> String {
        "\(MateNames.display(mate)) writes a handoff to memory, then a new conversation opens in the same repo. Personality and memory stay. This conversation stays until you end it."
    }
}

struct MateNewParams: Encodable, Sendable {
    var name: String
    var repo: String?
    var prompt: String?
}

struct MateMemoryParams: Encodable, Sendable {
    var name: String
    var text: String
}

struct MateSendParams: Encodable, Sendable {
    var session: String
    var text: String
}

extension MatesModel {
    public func loadMemory(_ name: String) async {
        do {
            let m: MateMemory = try await caller.call("mate.memory", params: MateNameParams(name: name))
            memory[name] = m
        } catch {
            message = ReviewController.message(error)
        }
    }

    public func saveMemory(_ name: String, text: String) async -> Bool {
        do {
            let m: MateMemory = try await caller.call("mate.set_memory", params: MateMemoryParams(name: name, text: text))
            memory[name] = m
            message = nil
            return true
        } catch {
            message = ReviewController.message(error)
            return false
        }
    }

    public func clearMemory(_ name: String) async {
        _ = await saveMemory(name, text: "")
    }

    public func newConversation(_ name: String, repo: String? = nil, prompt: String? = nil) async -> String? {
        do {
            let started: StartedSession = try await caller.call("mate.new", params: MateNewParams(name: name, repo: repo, prompt: prompt))
            message = nil
            return started.id
        } catch {
            message = ReviewController.message(error)
            return nil
        }
    }

    public func startFresh(_ session: Session, state: ViewState) async -> String? {
        guard StartFresh.offered(session), let mate = session.mate?.name else { return nil }
        do {
            let _: Ignored = try await caller.call("session.send", params: MateSendParams(session: session.id, text: StartFresh.handoff))
        } catch {
            message = ReviewController.message(error)
            return nil
        }
        let repo = MateConversations(state: state, mate: mate).repo(of: session.id)
        return await newConversation(mate, repo: repo)
    }
}
