#if canImport(SwiftUI)
import CrewKit
import SwiftUI

struct MateProfileView: View {
    let scene: MatesScene
    let definition: MateDefinition
    let actions: MatesActions
    @State private var confirmClear: Bool
    @State private var editing: String?
    @Environment(\.openURL) private var openURL

    init(scene: MatesScene, definition: MateDefinition, actions: MatesActions) {
        self.scene = scene
        self.definition = definition
        self.actions = actions
        _confirmClear = State(initialValue: scene.confirmClear)
    }

    var body: some View {
        let card = MateGallery(definitions: [definition], state: scene.state).cards[0]
        let conversations = scene.state.map { MateConversations(state: $0, mate: definition.name) }
        let row = scene.row(definition.name)
        VStack(spacing: 0) {
            hero(card, live: conversations?.live.count ?? 0, total: (conversations?.live.count ?? 0) + (conversations?.past.count ?? 0), row: row)
            Divider()
            HStack(alignment: .top, spacing: 24) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        list("Live", conversations?.live ?? [], live: true)
                        list("Past", conversations?.past ?? [], live: false)
                        if let row, !row.threads.isEmpty {
                            slackThreads(row)
                        }
                    }
                }
                memoryPanel(card).frame(width: 400)
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 24)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Color.primary.opacity(0.02))
        }
        .sheet(item: Binding(get: { editing.map(MemoryDraft.init) }, set: { editing = $0?.text })) { draft in
            MemoryEditSheet(name: definition.name, text: draft.text, limit: scene.memory?.limit ?? 8192, save: { text in
                actions.saveMemory(definition.name, text)
                editing = nil
            }, cancel: { editing = nil })
        }
    }

    private func hero(_ card: MateCard, live: Int, total: Int, row: MateRow?) -> some View {
        HStack(alignment: .center, spacing: 26) {
            MateFace(look: card.look, state: card.status.face, size: 120)
            VStack(alignment: .leading, spacing: 7) {
                Text(card.display).font(.system(size: 30, weight: .bold))
                Text(card.tagline).font(.system(size: 14)).foregroundStyle(.secondary).frame(maxWidth: 540, alignment: .leading)
                FlowChips(chips: [(card.brains, false)] + card.repos.map { ($0, true) } + (card.tones.isEmpty ? [] : [(card.tones.joined(separator: " · "), false)]))
                    .padding(.top, 3)
                if let row {
                    Text(row.label).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            HStack(spacing: 0) {
                stat("\(live)", "live now")
                stat("\(total)", "conversations")
            }
            VStack(alignment: .trailing, spacing: 8) {
                Button { actions.talk(definition.name) } label: { Label("New Conversation", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                HStack(spacing: 6) {
                    SlackButton { actions.connect(definition.name) }
                    if let row {
                        Button(row.paused ? "Resume" : "Pause") { actions.pause(row) }
                    }
                    Button { actions.edit(definition) } label: { Image(systemName: "gearshape") }
                        .help("Edit \(card.display)")
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 30)
        .padding(.bottom, 24)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 19, weight: .semibold))
            Text(label).font(.system(size: 11.5)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.1)).frame(width: 1) }
    }

    private func list(_ title: String, _ items: [MateConversation], live: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.leading, 4)
            VStack(spacing: 0) {
                if items.isEmpty {
                    Text(live ? "No live conversations. Start one with New Conversation." : "No past conversations yet.")
                        .foregroundStyle(.secondary).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                    if i > 0 { Divider() }
                    HStack(spacing: 12) {
                        if live { StateDot(state: item.state) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title).fontWeight(live ? .medium : .regular)
                            Text(live ? item.where : item.status + " · " + item.where)
                                .font(live ? .system(size: 11, design: .monospaced) : .system(size: 11.5)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if live {
                            Text(item.status).font(.system(size: 12)).foregroundStyle(.secondary)
                            Button("Open") { actions.openSession(item.id) }
                            Button { actions.startFresh(item.id) } label: { Label("Start Fresh", systemImage: "arrow.clockwise") }
                        } else {
                            Button { actions.openSession(item.id) } label: { Image(systemName: "chevron.right") }.buttonStyle(.borderless)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
            }
            .mateGroup()
        }
    }

    private func slackThreads(_ row: MateRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                SlackLogo(size: 12)
                Text("Slack threads").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(row.threads) { thread in
                    HStack {
                        Text(thread.ended ? "ended" : thread.state).font(.caption).foregroundStyle(.secondary).frame(width: 70, alignment: .leading)
                        Button(thread.label) { actions.openSession(thread.sessionID) }.buttonStyle(.link)
                        Spacer()
                        if let url = URL(string: thread.url), !thread.url.isEmpty {
                            Button("Open in Slack") { openURL(url) }.buttonStyle(.link)
                        }
                    }
                }
            }
            .padding(14)
            .mateGroup()
        }
    }

    private func memoryPanel(_ card: MateCard) -> some View {
        let memory = scene.memory?.name == definition.name ? scene.memory : nil
        let text = memory?.text ?? ""
        let meter = MemoryMeter(text: text, limit: memory?.limit ?? 8192)
        let notes = MemoryNotes.notes(text)
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Text("Memory").font(.headline)
                Spacer()
                Button("Edit…") { editing = text }
                Button("Clear…", role: .destructive) { confirmClear = true }
                    .disabled(text.isEmpty)
            }
            Text("Notes \(card.display) keeps across conversations. It reads them at the start of each one.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 5) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.primary.opacity(0.08))
                        Capsule().fill(meter.full ? Color.red : Color(hex: card.look.color)).frame(width: geo.size.width * meter.fraction)
                    }
                }
                .frame(height: 5)
                HStack {
                    Text(meter.label)
                    Spacer()
                    Text("memory.md").font(.system(size: 11, design: .monospaced))
                }
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
            }
            if notes.isEmpty {
                Text("Empty. \(card.display) writes notes here as it learns.").font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 4)
            }
            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                Divider()
                Text(note).font(.system(size: 12.5)).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .mateGroup()
        .overlay(alignment: .topTrailing) {
            if confirmClear {
                Group {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Clear \(card.display)'s memory?").font(.headline)
                            Text("\(card.display) forgets all \(notes.count) notes. Live conversations keep their context.")
                                .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            HStack {
                                Spacer()
                                Button("Cancel") { confirmClear = false }
                                Button("Clear Memory", role: .destructive) {
                                    confirmClear = false
                                    actions.clearMemory(definition.name)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.red)
                            }
                        }
                        .padding(14)
                        .frame(width: 300)
                    }
                .background(RoundedRectangle(cornerRadius: 10).fill(.background).shadow(color: .black.opacity(0.18), radius: 12, y: 4))
                .offset(x: 6, y: 48)
            }
        }
    }
}

struct MemoryDraft: Identifiable {
    let text: String
    var id: String { "memory" }
}

struct MemoryEditSheet: View {
    let name: String
    let limit: Int
    let save: (String) -> Void
    let cancel: () -> Void
    @State private var text: String

    init(name: String, text: String, limit: Int, save: @escaping (String) -> Void, cancel: @escaping () -> Void) {
        self.name = name
        self.limit = limit
        self.save = save
        self.cancel = cancel
        _text = State(initialValue: text)
    }

    var body: some View {
        let meter = MemoryMeter(text: text, limit: limit)
        VStack(alignment: .leading, spacing: 10) {
            Text("\(MateNames.display(name))'s memory").font(.title3.bold())
            Text("One note for each line. \(MateNames.display(name)) reads this file at the start of each conversation.")
                .foregroundStyle(.secondary)
            TextEditor(text: $text).font(.system(size: 12, design: .monospaced)).frame(minHeight: 260)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.15)))
            HStack {
                Text(meter.label).foregroundStyle(meter.full ? .red : .secondary)
                Spacer()
                Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
                Button("Save") { save(text) }.keyboardShortcut(.defaultAction).disabled(meter.full)
            }
        }
        .padding(18)
        .frame(width: 560)
    }
}
#endif
