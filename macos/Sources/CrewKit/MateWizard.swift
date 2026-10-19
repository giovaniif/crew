import Foundation

public enum MateNames {
    public static func display(_ name: String) -> String {
        let spaced = name.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
        guard let first = spaced.first else { return spaced }
        return first.uppercased() + spaced.dropFirst()
    }

    public static func slug(_ text: String) -> String {
        let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased()
        var out = ""
        var dash = false
        for scalar in folded.unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) || scalar == "_" {
                if dash, !out.isEmpty { out.append("-") }
                dash = false
                out.unicodeScalars.append(scalar)
            } else {
                dash = true
            }
        }
        return out
    }

    public static func valid(_ name: String) -> Bool {
        guard (1...32).contains(name.count), let first = name.unicodeScalars.first else { return false }
        let lower = { (s: Unicode.Scalar) in ("a"..."z").contains(s) || ("0"..."9").contains(s) }
        return lower(first) && name.unicodeScalars.allSatisfy { lower($0) || $0 == "-" || $0 == "_" }
    }
}

public enum MateStep: Int, CaseIterable, Sendable {
    case face, personality, brains, meet

    public var title: String {
        switch self {
        case .face: "Face"
        case .personality: "Personality"
        case .brains: "Brains"
        case .meet: "Meet"
        }
    }

    public var label: String { "Step \(rawValue + 1) of \(Self.allCases.count)" }
}

public struct MatePreset: Sendable, Equatable {
    public var title: String
    public var detail: String
    public var template: String
    public var tones: MateTones

    public func body(_ name: String) -> String {
        template.replacingOccurrences(of: "{name}", with: name)
    }

    public static let all: [MatePreset] = {
        var reviewer = MateTones()
        reviewer[.terse] = 1
        reviewer[.cautious] = 1
        var fixer = MateTones()
        fixer[.terse] = 1
        fixer[.cautious] = 3
        var explainer = MateTones()
        explainer[.terse] = 3
        explainer[.formal] = 3
        return [
            MatePreset(
                title: "Careful reviewer", detail: "Thorough, cites lines",
                template: "You are {name}, a careful code reviewer. Read the whole diff before you comment. Point at exact lines. When a change is risky, say why and propose the smallest safe fix.",
                tones: reviewer
            ),
            MatePreset(
                title: "Fast bug fixer", detail: "Smallest diff",
                template: "You are {name}, a fast bug fixer. Find the cause, write a failing test, then make the smallest diff that makes it pass.",
                tones: fixer
            ),
            MatePreset(
                title: "Patient explainer", detail: "Teaches as it goes",
                template: "You are {name}, a patient explainer. Say what you do and why, in plain words. Check that the owner follows before you go on.",
                tones: explainer
            ),
            MatePreset(title: "Blank", detail: "Write your own", template: "", tones: MateTones()),
        ]
    }()
}

public struct MateWizard: Sendable, Equatable {
    public var step: MateStep = .face
    public var displayName = ""
    public private(set) var avatar: String?
    public private(set) var pickedColor: String?
    public var personality = ""
    public var tones = MateTones()
    public var memory = true
    public private(set) var preset: Int?
    public private(set) var agent = "claude"
    public var model = ""
    public var effort = ""
    public private(set) var repos: [String] = []
    public let options: [HarnessOptions]
    public let taken: [String]
    public let original: MateDefinition?

    public init(options: [HarnessOptions], taken: [String] = [], axes: [ToneAxisInfo] = []) {
        self.options = options
        self.taken = taken
        original = nil
        tones = MateTones(axes: axes)
        choose(agent: options.first { $0.harness == "claude" }?.harness ?? options.first?.harness ?? "claude")
    }

    public init(editing def: MateDefinition, options: [HarnessOptions], axes: [ToneAxisInfo] = []) {
        self.options = options
        taken = []
        original = def
        displayName = MateNames.display(def.name)
        avatar = def.avatar ?? Face.fallback(for: def.name).id
        pickedColor = def.color
        personality = def.prompt
        tones = MateTones(def.tone, axes: axes)
        memory = def.noMemory != true
        agent = def.agent
        model = def.model ?? ""
        effort = def.effort ?? ""
        repos = def.repos ?? []
    }

    public var isNew: Bool { original == nil }

    public var face: Face {
        avatar.flatMap(Face.named) ?? Face.fallback(for: original?.name ?? MateNames.slug(displayName))
    }

    public var color: String { pickedColor ?? face.accent.light }

    public var look: MateLook { MateLook(face: face, color: color) }

    public var draft: MateDraft {
        var d = original.map { MateDraft($0) } ?? MateDraft()
        if isNew { d.name = MateNames.slug(displayName) }
        d.agent = agent
        d.model = model
        d.effort = effort
        d.repos = repos.joined(separator: ", ")
        d.prompt = personality.trimmingCharacters(in: .whitespacesAndNewlines)
        d.tone = tones.value
        d.noMemory = !memory
        d.avatar = face.id
        d.color = color
        return d
    }

    public var shownName: String { displayName.isEmpty ? face.name : displayName }

    public mutating func choose(face id: String) {
        let previous = avatar.flatMap(Face.named)?.name
        if displayName.isEmpty || displayName == previous, isNew, let face = Face.named(id) {
            displayName = face.name
        }
        avatar = id
    }

    public mutating func choose(color accent: FaceAccent) {
        pickedColor = accent.light
    }

    public mutating func suggest() {
        let current = MateNames.slug(displayName)
        guard let face = Face.all.first(where: { f in
            let slug = MateNames.slug(f.name)
            return !taken.contains(slug) && slug != current
        }) else { return }
        avatar = face.id
        displayName = face.name
    }

    public mutating func apply(preset index: Int) {
        guard MatePreset.all.indices.contains(index) else { return }
        let p = MatePreset.all[index]
        preset = index
        personality = p.body(shownName)
        for axis in ToneAxis.allCases { tones[axis] = p.tones[axis] }
    }

    public var option: HarnessOptions? { options.first { $0.harness == agent } }

    public var models: [String] { option?.models ?? [] }

    public var efforts: [String] { option?.efforts ?? [] }

    public mutating func choose(agent harness: String) {
        agent = harness
        let o = option
        model = [o?.defaultModel, o?.model].compactMap { $0 }.first { !$0.isEmpty } ?? ""
        effort = [o?.defaultEffort, o?.effort].compactMap { $0 }.first { !$0.isEmpty } ?? ""
    }

    public mutating func toggle(repo: String) {
        if let i = repos.firstIndex(of: repo) {
            repos.remove(at: i)
        } else {
            repos.append(repo)
        }
    }

    public static func repoChoices(_ workspaces: [Workspace]) -> [String] {
        workspaces.filter { $0.kind == "single" }.map { ws in
            if case let .object(repo)? = ws.repos.first, case let .string(name)? = repo["Name"], !name.isEmpty {
                return name
            }
            return URL(fileURLWithPath: ws.root).lastPathComponent
        }
    }

    public static func effortHint(_ effort: String) -> String {
        switch effort {
        case "low", "minimal": "Answers fast. Uses less of your limits."
        case "medium": "Balances speed and depth."
        case "high": "Thinks more before it answers. Uses more of your limits."
        case "": "Uses the default effort of the agent."
        default: "Thinks the most before it answers. Uses the most of your limits."
        }
    }

    public var problem: String? {
        switch step {
        case .face:
            if !isNew { return nil }
            let slug = MateNames.slug(displayName)
            if slug.isEmpty { return "Give the mate a name." }
            if !MateNames.valid(slug) { return "Use up to 32 letters, digits, - and _." }
            if taken.contains(slug) { return "A mate named \(slug) exists." }
            return nil
        case .personality:
            return personality.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Write a personality prompt or pick a preset." : nil
        case .brains, .meet:
            return nil
        }
    }

    public var canContinue: Bool { problem == nil }

    public mutating func next() {
        guard canContinue, let after = MateStep(rawValue: step.rawValue + 1) else { return }
        step = after
    }

    public mutating func back() {
        if let before = MateStep(rawValue: step.rawValue - 1) { step = before }
    }

    public var brainsLine: String {
        var parts = [option?.name ?? agent]
        if !model.isEmpty { parts.append(model) }
        if !effort.isEmpty { parts.append(effort + " effort") }
        return parts.joined(separator: " · ")
    }

    public var reposLine: String {
        repos.isEmpty ? "The first repo of each conversation" : repos.joined(separator: ", ")
    }

    public var memoryLine: String {
        memory ? "Empty. \(shownName) writes notes here as it learns." : "Off. \(shownName) keeps no notes."
    }

    public var tagline: String {
        MateCard.tagline(personality)
    }
}
