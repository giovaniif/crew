#if canImport(SwiftUI)
import CrewKit
import SwiftUI

public struct NewMateSheet: View {
    @State private var wizard: MateWizard
    let repoChoices: [String]
    let message: String?
    let save: (MateDraft, Bool) -> Void
    let connect: (String) -> Void
    let cancel: () -> Void

    public init(
        wizard: MateWizard, repoChoices: [String], message: String? = nil,
        save: @escaping (MateDraft, Bool) -> Void, connect: @escaping (String) -> Void = { _ in }, cancel: @escaping () -> Void
    ) {
        _wizard = State(initialValue: wizard)
        self.repoChoices = repoChoices
        self.message = message
        self.save = save
        self.connect = connect
        self.cancel = cancel
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                if wizard.step != .meet {
                    preview.frame(width: 270)
                    Divider()
                }
                ScrollView {
                    form.padding(.horizontal, 28).padding(.vertical, 22).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(height: 560)
            Divider()
            footer
        }
        .frame(width: 860)
        .tint(Color(hex: wizard.color))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(wizard.isNew ? "New Mate" : "Edit \(wizard.shownName)").font(.system(size: 14, weight: .semibold))
            Spacer()
            ForEach(MateStep.allCases, id: \.self) { step in
                if step != .face { Rectangle().fill(Color.primary.opacity(0.12)).frame(width: 22, height: 1) }
                let done = step.rawValue < wizard.step.rawValue
                let on = step == wizard.step
                HStack(spacing: 6) {
                    Circle().fill(on ? Color(hex: wizard.color) : done ? Color.green : Color.primary.opacity(0.08))
                        .frame(width: 18, height: 18)
                        .overlay(Text(done ? "✓" : "\(step.rawValue + 1)").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(on || done ? Color.white : Color.secondary))
                    Text(step.title).font(.system(size: 12.5, weight: on ? .semibold : .regular)).foregroundStyle(on ? .primary : .secondary)
                }
            }
            Spacer()
            Text(wizard.step.label).font(.system(size: 12)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    private var preview: some View {
        VStack(spacing: 8) {
            Text("Preview").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 10)
            MateFace(look: wizard.look, size: 128)
            Text(wizard.shownName).font(.system(size: 21, weight: .bold)).padding(.top, 8)
            if wizard.tagline.isEmpty {
                Text("Personality comes next").font(.system(size: 12.5)).foregroundStyle(.tertiary)
            } else {
                Text(wizard.tagline).font(.system(size: 12.5)).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(4)
            }
            let tags = wizard.step == .brains ? [[wizard.model, wizard.effort].filter { !$0.isEmpty }.joined(separator: " · ")] + wizard.repos : wizard.tones.chips
            if !tags.isEmpty {
                HStack(spacing: 5) { ForEach(tags.filter { !$0.isEmpty }, id: \.self) { Chip(text: $0) } }
            }
            Spacer()
            Text("Hi, I am \(wizard.shownName). Give me a task and I will start in a fresh worktree.")
                .font(.system(size: 12))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 4, bottomTrailingRadius: 12, topTrailingRadius: 12).fill(.background))
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 4, bottomTrailingRadius: 12, topTrailingRadius: 12).strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 26)
        .frame(maxHeight: .infinity)
        .background(.background.secondary)
    }

    @ViewBuilder private var form: some View {
        switch wizard.step {
        case .face: faceStep
        case .personality: personalityStep
        case .brains: brainsStep
        case .meet: meetStep
        }
    }

    private func title(_ text: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(text).font(.system(size: 22, weight: .bold))
            Text(detail).foregroundStyle(.secondary)
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }

    private var faceStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            title(wizard.isNew ? "Who is joining the crew?" : "Face and color", "Pick a face and a color. You can change both later.")
            VStack(alignment: .leading, spacing: 8) {
                caption("Face")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6), spacing: 10) {
                    ForEach(Face.all) { face in
                        let on = wizard.face.id == face.id
                        Button { wizard.choose(face: face.id) } label: {
                            VStack(spacing: 3) {
                                MateFace(look: MateLook(face: face, color: on ? wizard.color : face.accent.light), size: 46)
                                Text(face.name).font(.system(size: 11, weight: on ? .semibold : .regular)).foregroundStyle(on ? .primary : .secondary)
                            }
                            .padding(.top, 8)
                            .padding(.bottom, 6)
                            .frame(maxWidth: .infinity)
                            .background(RoundedRectangle(cornerRadius: 10).fill(on ? Color(hex: wizard.color).opacity(0.1) : .clear))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? Color(hex: wizard.color) : .clear, lineWidth: 2))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(face.name)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                caption("Accent color")
                HStack(spacing: 11) {
                    ForEach(FaceAccent.swatches, id: \.self) { accent in
                        let on = wizard.color == accent.light
                        Button { wizard.choose(color: accent) } label: {
                            Circle().fill(Color(hex: accent.light)).frame(width: 22, height: 22)
                                .padding(3)
                                .overlay(Circle().strokeBorder(on ? Color(hex: accent.light) : .clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(accent.rawValue)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                caption("Name")
                HStack(spacing: 8) {
                    TextField("Name", text: $wizard.displayName)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 300)
                        .disabled(!wizard.isNew)
                    if wizard.isNew {
                        Button("Suggest") { wizard.suggest() }
                    }
                }
                if wizard.isNew, !wizard.displayName.isEmpty {
                    Text("Its handle is \(wizard.draft.name).").font(.system(size: 11.5)).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private var personalityStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            title("How does \(wizard.shownName) think and talk?", "A preset fills the prompt and sets the tone. You can edit both.")
            HStack(spacing: 8) {
                ForEach(Array(MatePreset.all.enumerated()), id: \.offset) { i, preset in
                    Button { wizard.apply(preset: i) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(preset.title).font(.system(size: 12.5, weight: .semibold))
                            Text(preset.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(.background))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(wizard.preset == i ? Color(hex: wizard.color) : Color.primary.opacity(0.15), lineWidth: wizard.preset == i ? 2 : 0.5))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                caption("Personality prompt")
                TextEditor(text: $wizard.personality)
                    .font(.system(size: 12.5))
                    .frame(height: 96)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.2), lineWidth: 0.5))
            }
            VStack(alignment: .leading, spacing: 10) {
                caption("Tone")
                ForEach(ToneAxis.allCases, id: \.self) { axis in
                    ToneSteps(axis: axis, step: Binding(get: { wizard.tones[axis] }, set: { wizard.tones[axis] = $0 }), color: Color(hex: wizard.color))
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    caption("Added to the prompt")
                    Text("· read only, from the tone steps").font(.caption).foregroundStyle(.tertiary)
                }
                ForEach(wizard.tones.lines) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(line.label).font(.system(size: 11, design: .monospaced)).foregroundStyle(.tertiary).frame(width: 96, alignment: .leading)
                        if let sentence = line.sentence {
                            Text("“\(sentence)”").font(.system(size: 12.5)).fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text("Middle step. Adds no text.").font(.system(size: 12.5)).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(.background.secondary))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
        }
    }

    private var brainsStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            title("Brains and reach", "Every new conversation starts with these settings.")
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 16) {
                GridRow {
                    Text("Agent:").gridColumnAlignment(.trailing)
                    Picker("Agent", selection: Binding(get: { wizard.agent }, set: { wizard.choose(agent: $0) })) {
                        ForEach(wizard.options.isEmpty ? ["claude", "codex"] : wizard.options.map(\.harness), id: \.self) { harness in
                            Text(wizard.options.first { $0.harness == harness }?.name ?? MateCard.agentTitle(harness)).tag(harness)
                        }
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
                GridRow {
                    Text("Model:")
                    choice(wizard.models, $wizard.model)
                }
                GridRow(alignment: .top) {
                    Text("Effort:")
                    VStack(alignment: .leading, spacing: 5) {
                        choice(wizard.efforts, $wizard.effort)
                        Text(MateWizard.effortHint(wizard.effort)).font(.system(size: 11.5)).foregroundStyle(.tertiary)
                    }
                }
                GridRow(alignment: .top) {
                    Text("Repos:")
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 6) {
                            ForEach(Array(Set(repoChoices + wizard.repos)).sorted(), id: \.self) { repo in
                                let on = wizard.repos.contains(repo)
                                Button { wizard.toggle(repo: repo) } label: {
                                    Text(on ? repo + " ✕" : repo)
                                        .font(.system(size: 11, design: .monospaced))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Capsule().fill(on ? Color(hex: wizard.color).opacity(0.15) : Color.primary.opacity(0.06)))
                                        .foregroundStyle(on ? .primary : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        if repoChoices.isEmpty {
                            Text("Add a single-repo workspace in Settings to pick a repo.").font(.system(size: 11.5)).foregroundStyle(.tertiary)
                        }
                    }
                }
                GridRow {
                    Text("Memory:")
                    Toggle("Keep notes across conversations", isOn: $wizard.memory).toggleStyle(.checkbox)
                }
            }
            .font(.system(size: 13))
        }
    }

    private func choice(_ values: [String], _ selection: Binding<String>) -> some View {
        Group {
            if values.isEmpty {
                TextField("default", text: selection).textFieldStyle(.roundedBorder).frame(width: 200)
            } else {
                Picker("", selection: selection) {
                    ForEach(values, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
        }
    }

    private var meetStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 30) {
                MateFace(look: wizard.look, size: 150)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Meet \(wizard.shownName)").font(.system(size: 30, weight: .bold))
                    Text(wizard.tagline).font(.system(size: 14)).foregroundStyle(.secondary).frame(maxWidth: 460, alignment: .leading).lineLimit(3)
                    HStack(spacing: 5) { ForEach(wizard.tones.chips, id: \.self) { Chip(text: $0) } }.padding(.top, 4)
                }
            }
            .padding(.top, 10)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                GridRow {
                    Text("Agent").foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                    Text(wizard.brainsLine)
                }
                GridRow {
                    Text("Repos").foregroundStyle(.secondary)
                    Text(wizard.reposLine).font(.system(size: 13, design: wizard.repos.isEmpty ? .default : .monospaced))
                }
                GridRow {
                    Text("Memory").foregroundStyle(.secondary)
                    Text(wizard.memoryLine)
                }
            }
            .font(.system(size: 13))
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .mateGroup()
            HStack(spacing: 12) {
                SlackLogo(size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("Slack").fontWeight(.medium)
                        Text("· optional").foregroundStyle(.tertiary)
                    }
                    Text("Let people message \(wizard.shownName) from a channel. Connect it after you create the mate.").font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                SlackButton { connect(wizard.draft.name) }.disabled(wizard.isNew)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .mateGroup()
            Text("\(wizard.shownName) starts with fresh context in each conversation and keeps its personality and memory.")
                .font(.system(size: 12)).foregroundStyle(.secondary).padding(.leading, 4)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if let message {
                Text(message).font(.system(size: 11.5)).foregroundStyle(.orange).lineLimit(2)
            } else if let problem = wizard.problem, wizard.step != .meet {
                Text(problem).font(.system(size: 11.5)).foregroundStyle(.tertiary)
            } else if wizard.step != .meet {
                Text("Slack is optional. Connect it later from the profile.").font(.system(size: 11.5)).foregroundStyle(.tertiary)
            }
            Spacer()
            if wizard.step != .meet {
                Button("Cancel", action: cancel).keyboardShortcut(.cancelAction).controlSize(.large)
            }
            if wizard.step != .face {
                Button("Back") { wizard.back() }.controlSize(.large)
            }
            if wizard.step == .meet {
                Button(wizard.isNew ? "Create" : "Save") { save(wizard.draft, false) }.controlSize(.large)
                Button(wizard.isNew ? "Create and Talk" : "Save and Talk") { save(wizard.draft, true) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            } else {
                Button("Continue") { wizard.next() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!wizard.canContinue)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
    }
}

struct ToneSteps: View {
    let axis: ToneAxis
    @Binding var step: Int
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            Text(axis.left).font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 70, alignment: .leading)
            ZStack {
                Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 2).padding(.horizontal, 4)
                HStack {
                    ForEach(0..<5, id: \.self) { i in
                        if i > 0 { Spacer() }
                        Button { step = i } label: {
                            Circle()
                                .fill(Color.white)
                                .frame(width: i == step ? 18 : 8, height: i == step ? 18 : 8)
                                .overlay(Circle().strokeBorder(i == step ? color : Color.black.opacity(0.25), lineWidth: i == step ? 5 : 1))
                                .shadow(color: .black.opacity(i == step ? 0.2 : 0), radius: 1.5, y: 1)
                                .frame(width: 20, height: 20)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(axis.label(i))
                    }
                }
            }
            .frame(height: 20)
            HStack(spacing: 4) {
                Text(axis.right).foregroundStyle(.secondary)
                Text("\(step + 1)/5").font(.system(size: 10.5, design: .monospaced)).foregroundStyle(.tertiary)
            }
            .font(.system(size: 12))
            .frame(width: 90, alignment: .trailing)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: step = min(4, step + 1)
            case .decrement: step = max(0, step - 1)
            @unknown default: break
            }
        }
    }
}
#endif
