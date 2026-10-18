#if canImport(SwiftUI)
import CrewKit
import SwiftUI

public struct MatesScene {
    public var board: MateBoard
    public var definitions: [MateDefinition]
    public var problems: [String]
    public var approvals: [ApprovalItem]
    public var message: String?
    public var state: ViewState?
    public var filter: MateFilter
    public var search: String
    public var profile: String?
    public var memory: MateMemory?
    public var confirmClear: Bool

    public init(
        board: MateBoard = MateBoard(), definitions: [MateDefinition] = [], problems: [String] = [],
        approvals: [ApprovalItem] = [], message: String? = nil, state: ViewState? = nil, filter: MateFilter = .all,
        search: String = "", profile: String? = nil, memory: MateMemory? = nil, confirmClear: Bool = false
    ) {
        self.board = board
        self.definitions = definitions
        self.problems = problems
        self.approvals = approvals
        self.message = message
        self.state = state
        self.filter = filter
        self.search = search
        self.profile = profile
        self.memory = memory
        self.confirmClear = confirmClear
    }

    public static func seeded(profile: String? = nil, confirmClear: Bool = false) -> MatesScene {
        let state = Seed.mates
        return MatesScene(
            board: state.mates ?? MateBoard(), definitions: Seed.mateDefinitions, state: state,
            profile: profile, memory: profile == nil ? nil : Seed.mateMemory, confirmClear: confirmClear
        )
    }

    var gallery: MateGallery {
        var g = MateGallery(definitions: definitions, state: state)
        g.filter = filter
        g.search = search
        return g
    }

    func row(_ name: String) -> MateRow? { board.mates.first { $0.name == name } }
}

public struct MatesActions {
    public var pause: (MateRow) -> Void = { _ in }
    public var stopAll: (Bool) -> Void = { _ in }
    public var edit: (MateDefinition?) -> Void = { _ in }
    public var connect: (String) -> Void = { _ in }
    public var openSession: (String) -> Void = { _ in }
    public var decide: (ApprovalItem, Bool) -> Void = { _, _ in }
    public var filter: (MateFilter) -> Void = { _ in }
    public var search: (String) -> Void = { _ in }
    public var profile: (String?) -> Void = { _ in }
    public var talk: (String) -> Void = { _ in }
    public var startFresh: (String) -> Void = { _ in }
    public var saveMemory: (String, String) -> Void = { _, _ in }
    public var clearMemory: (String) -> Void = { _ in }

    public init() {}
}

public struct MatesWindow: View {
    let scene: MatesScene
    let actions: MatesActions
    @State private var confirmStop = false

    public init(scene: MatesScene, actions: MatesActions = MatesActions()) {
        self.scene = scene
        self.actions = actions
    }

    public var body: some View {
        let gallery = scene.gallery
        VStack(spacing: 0) {
            toolbar(gallery)
            Divider()
            HStack(spacing: 0) {
                sources(gallery)
                    .frame(width: 210)
                    .background(.background.secondary)
                Divider()
                if let name = scene.profile, let def = scene.definitions.first(where: { $0.name == name }) {
                    MateProfileView(scene: scene, definition: def, actions: actions)
                } else {
                    galleryBody(gallery)
                }
            }
        }
        .background(.background)
        .confirmationDialog("Stop all mates?", isPresented: $confirmStop) {
            Button("Stop all", role: .destructive) { actions.stopAll(true) }
        } message: {
            Text("No mate starts a new turn until you start them again.")
        }
    }

    private func toolbar(_ gallery: MateGallery) -> some View {
        HStack(spacing: 10) {
            if scene.profile != nil {
                Button { actions.profile(nil) } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.borderless)
                    .help("All mates")
            }
            Text(scene.profile.map(MateNames.display) ?? "Mates").font(.headline)
            if scene.profile == nil {
                Text(gallery.summary).foregroundStyle(.secondary)
            }
            Spacer()
            if scene.profile == nil {
                TextField("Search", text: Binding(get: { scene.search }, set: actions.search))
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 200)
            }
            Menu {
                if scene.board.stopped {
                    Button("Start all mates") { actions.stopAll(false) }
                } else {
                    Button("Stop all mates…", role: .destructive) { confirmStop = true }
                }
            } label: {
                Image(systemName: scene.board.stopped ? "stop.circle.fill" : "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            Button { actions.edit(nil) } label: { Label("New Mate", systemImage: "plus") }
                .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 14)
        .frame(height: 46)
    }

    private func sources(_ gallery: MateGallery) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                caption("Mates")
                source("All Mates", .all, gallery)
                source("Live", .live, gallery)
                source("Claude", .agent("claude"), gallery)
                source("Codex", .agent("codex"), gallery)
                caption("Crew").padding(.top, 12)
                ForEach(gallery.cards) { card in
                    Button { actions.profile(card.name) } label: {
                        HStack(spacing: 8) {
                            MateFace(look: card.look, state: card.status.face, size: 22)
                            Text(card.display)
                            Spacer()
                            if card.live > 0 { Text("\(card.live)").foregroundStyle(.tertiary) }
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(RoundedRectangle(cornerRadius: 6).fill(scene.profile == card.name ? Color.primary.opacity(0.08) : .clear))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 8).padding(.vertical, 4)
    }

    private func source(_ title: String, _ filter: MateFilter, _ gallery: MateGallery) -> some View {
        let on = scene.profile == nil && scene.filter == filter
        return Button {
            actions.profile(nil)
            actions.filter(filter)
        } label: {
            HStack {
                Text(title).fontWeight(on ? .medium : .regular)
                Spacer()
                Text("\(gallery.count(filter))").foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 6).fill(on ? Color.primary.opacity(0.08) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func galleryBody(_ gallery: MateGallery) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your crew").font(.largeTitle.bold())
                    Text("Each mate keeps its personality and memory. Start a new conversation with any of them at any time.")
                        .foregroundStyle(.secondary)
                }
                if scene.board.stopped {
                    Label("All mates are stopped. No mate starts a new turn.", systemImage: "stop.circle.fill").foregroundStyle(.red)
                }
                if let message = scene.message {
                    Text(message).foregroundStyle(.orange)
                }
                ForEach(scene.problems, id: \.self) { problem in
                    Text(problem).font(.caption).foregroundStyle(.orange)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 18)], spacing: 18) {
                    ForEach(gallery.shown) { card in
                        MateCardView(card: card, row: scene.row(card.name), actions: actions)
                    }
                    NewMateCard { actions.edit(nil) }
                }
                if !scene.approvals.isEmpty {
                    Text("Approvals").font(.headline).padding(.top, 8)
                    ForEach(scene.approvals) { approval in
                        approvalCard(approval)
                    }
                }
            }
            .padding(.horizontal, 36)
            .padding(.vertical, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func approvalCard(_ approval: ApprovalItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(approval.title).font(.headline)
                Text("asked by " + (approval.requester.isEmpty ? "someone" : approval.requester)).foregroundStyle(.secondary)
                Spacer()
                Button("Open session") { actions.openSession(approval.sessionID) }
                Button("Deny", role: .destructive) { actions.decide(approval, false) }
                Button("Approve") { actions.decide(approval, true) }
            }
            Text(approval.action.tool + ": " + approval.action.input).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
        }
        .padding(12)
        .mateGroup()
    }
}

struct MateGroup: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: 10).fill(.background))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
    }
}

extension View {
    func mateGroup() -> some View { modifier(MateGroup()) }
}

struct Chip: View {
    let text: String
    var mono = false

    var body: some View {
        Text(text)
            .font(mono ? .system(size: 11, design: .monospaced) : .system(size: 11))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
            .foregroundStyle(.secondary)
    }
}

struct StateDot: View {
    let state: String

    var body: some View {
        GlyphView(style: StateStyle(state: state), size: 8)
    }
}

struct MateCardView: View {
    let card: MateCard
    let row: MateRow?
    let actions: MatesActions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                MateFace(look: card.look, state: card.status.face, size: 84)
                Spacer()
                HStack(spacing: 4) {
                    if card.live > 0 { StateDot(state: "running") }
                    Text(card.liveLabel)
                }
                .font(.system(size: 11))
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.primary.opacity(0.06)))
                .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(card.display).font(.system(size: 19, weight: .bold))
                Text(card.tagline).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(2).frame(minHeight: 34, alignment: .top)
            }
            FlowChips(chips: card.repos.map { ($0, true) } + [(card.brains, false)])
            Divider()
            HStack(spacing: 8) {
                StateDot(state: card.status.state)
                Text(card.status.text).font(.system(size: 12.5)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                if row?.state == "no_tokens" || row?.state == "connected" {
                    SlackLogo(size: 12).help(row?.state == "connected" ? "Connected to Slack" : "Not connected to Slack")
                }
                Button("Profile") { actions.profile(card.name) }.buttonStyle(.borderless)
                Button("Talk") { actions.talk(card.name) }.buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .mateGroup()
    }
}

struct FlowChips: View {
    let chips: [(String, Bool)]

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in
                Chip(text: chip.0, mono: chip.1)
            }
        }
    }
}

struct NewMateCard: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Circle().fill(Color.primary.opacity(0.05)).frame(width: 84, height: 84)
                .overlay(Image(systemName: "plus").font(.system(size: 30, weight: .light)).foregroundStyle(.tertiary))
            Text("New mate").font(.system(size: 19, weight: .bold))
            Text("Pick a face, give it a personality, choose its brains.").font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 220)
            Button("Create a Mate…", action: action)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 250)
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.15), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
    }
}

public struct MateConnectSheet: View {
    let name: String
    let setup: MateSetupLink?
    let claim: MateClaimCode?
    let message: String?
    let connect: (String, String) -> Void
    let done: () -> Void
    @State private var bot = ""
    @State private var app = ""
    @Environment(\.openURL) private var openURL

    public init(name: String, setup: MateSetupLink?, claim: MateClaimCode?, message: String? = nil, connect: @escaping (String, String) -> Void, done: @escaping () -> Void) {
        self.name = name
        self.setup = setup
        self.claim = claim
        self.message = message
        self.connect = connect
        self.done = done
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SlackLogo(size: 22)
                Text("Connect \(MateNames.display(name)) to Slack").font(.title3.bold())
            }
            if let setup, let url = URL(string: setup.url) {
                Button("1. Make the Slack app from the manifest") { openURL(url) }.buttonStyle(.link)
            }
            Text("2. Install the app in your workspace. A workspace admin may need to approve it first.")
            Text("3. Copy the bot token (xoxb-) from OAuth & Permissions.")
            Text("4. Make an app-level token (xapp-) with the scope connections:write in Basic Information, and copy it.")
            if let claim {
                Text("To become the owner of \(name), send this code to @\(name) in a direct message in Slack in the next 10 minutes:")
                Text(claim.code).font(.system(.title2, design: .monospaced)).textSelection(.enabled)
            } else {
                SecureField("Bot token", text: $bot)
                SecureField("App token", text: $app)
            }
            if let message {
                Text(message).foregroundStyle(.orange)
            }
            HStack {
                Spacer()
                Button("Done", action: done).keyboardShortcut(.cancelAction)
                if claim == nil {
                    Button("Save tokens") { connect(bot, app) }
                        .keyboardShortcut(.defaultAction)
                        .disabled(bot.isEmpty || app.isEmpty)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 520)
    }
}
#endif
