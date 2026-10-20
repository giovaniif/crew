#if canImport(SwiftUI)
import CrewKit
import SwiftUI

struct MateEditing: Identifiable {
    let id = UUID()
    let wizard: MateWizard
}

struct MateConnecting: Identifiable {
    let id = UUID()
    let name: String
}

public struct LiveMatesWindow: View {
    let store: ViewStore
    let router: WindowRouter
    @State private var model: MatesModel?
    @State private var editing: MateEditing?
    @State private var connecting: MateConnecting?
    @State private var options: [HarnessOptions] = []
    @State private var filter: MateFilter = .all
    @State private var search = ""
    @State private var fresh: String?
    @Environment(\.openWindow) private var openWindow

    public init(store: ViewStore, router: WindowRouter) {
        self.store = store
        self.router = router
    }

    public var body: some View {
        MatesWindow(
            scene: MatesScene(
                board: store.state?.mates ?? MateBoard(), definitions: model?.definitions ?? [], problems: model?.problems ?? [],
                approvals: model?.approvals ?? [], message: model?.message, state: store.state, filter: filter, search: search,
                profile: router.mateProfile, memory: router.mateProfile.flatMap { model?.memory[$0] }
            ),
            actions: actions
        )
        .frame(minWidth: 980, minHeight: 640)
        .task {
            store.start()
            let m = MatesModel(caller: store)
            model = m
            await m.load()
            if let name = router.mateProfile { await m.loadMemory(name) }
            if let o: SessionOptions = try? await store.call("session.options", params: [String: String]()) {
                options = o.harnesses
            }
        }
        .onChange(of: router.mateProfile) { _, name in
            if let name { Task { await model?.loadMemory(name) } }
        }
        .sheet(item: $editing) { edit in
            NewMateSheet(
                wizard: edit.wizard, repoChoices: MateWizard.repoChoices(store.state?.workspaces ?? []), message: model?.message,
                save: { draft, talk in
                    Task {
                        guard await model?.save(draft) == true else { return }
                        editing = nil
                        router.mateProfile = draft.mate.name
                        if talk { await self.talk(draft.mate.name) }
                    }
                },
                connect: { name in
                    editing = nil
                    Task { await begin(name) }
                },
                cancel: { editing = nil }
            )
        }
        .sheet(item: $connecting) { c in
            MateConnectSheet(name: c.name, setup: model?.setup, claim: model?.claim, message: model?.message, connect: { bot, app in
                Task { await model?.connect(c.name, bot: bot, app: app) }
            }, done: { connecting = nil })
        }
        .confirmationDialog(fresh.map { StartFresh.title(mateOf($0) ?? "") } ?? "", isPresented: Binding(get: { fresh != nil }, set: { if !$0 { fresh = nil } })) {
            Button("Start Fresh") {
                guard let id = fresh else { return }
                fresh = nil
                Task { await startFresh(id, sameWorktree: true) }
            }
            Button("Start Fresh in a New Worktree") {
                guard let id = fresh else { return }
                fresh = nil
                Task { await startFresh(id, sameWorktree: false) }
            }
        } message: {
            Text(fresh.flatMap(mateOf).map(StartFresh.detail) ?? "")
        }
    }

    private func mateOf(_ session: String) -> String? {
        store.state?.sessions.first { $0.id == session }?.mate?.name
    }

    private var actions: MatesActions {
        var a = MatesActions()
        a.pause = { row in Task { await model?.setPaused(row.name, paused: !row.paused) } }
        a.stopAll = { stop in Task { await model?.stopAll(stop) } }
        a.edit = { def in
            let taken = model?.definitions.map(\.name) ?? []
            let axes = model?.tones ?? []
            editing = MateEditing(wizard: def.map { MateWizard(editing: $0, options: options, axes: axes) } ?? MateWizard(options: options, taken: taken, axes: axes))
        }
        a.connect = { name in Task { await begin(name) } }
        a.openSession = open
        a.decide = { approval, approve in Task { await model?.decide(approval.id, approve: approve) } }
        a.filter = { filter = $0 }
        a.search = { search = $0 }
        a.profile = { router.mateProfile = $0 }
        a.talk = { name in Task { await talk(name) } }
        a.startFresh = { fresh = $0 }
        a.saveMemory = { name, text in Task { _ = await model?.saveMemory(name, text: text) } }
        a.clearMemory = { name in Task { await model?.clearMemory(name) } }
        return a
    }

    private func open(_ session: String) {
        router.goTo(session: session)
        openWindow(id: "main")
    }

    private func talk(_ name: String) async {
        if let id = await model?.newConversation(name) { open(id) }
    }

    private func startFresh(_ id: String, sameWorktree: Bool) async {
        guard let session = store.state?.sessions.first(where: { $0.id == id }) else { return }
        if let next = await model?.startFresh(session, sameWorktree: sameWorktree) { open(next) }
    }

    private func begin(_ name: String) async {
        await model?.startSetup(name)
        connecting = MateConnecting(name: name)
    }
}
#endif
