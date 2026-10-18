import Foundation

public enum ToneAxis: String, CaseIterable, Sendable {
    case terse, cautious, formal

    public var left: String {
        switch self {
        case .terse: "Terse"
        case .cautious: "Cautious"
        case .formal: "Formal"
        }
    }

    public var right: String {
        switch self {
        case .terse: "Chatty"
        case .cautious: "Bold"
        case .formal: "Playful"
        }
    }

    public var sentences: [String?] {
        switch self {
        case .terse:
            [
                "Keep answers very short. Use lists, not paragraphs, and give no background unless asked.",
                "Keep answers short. Use lists, not paragraphs.",
                nil,
                "Explain your thinking in a few sentences.",
                "Explain your thinking in full, and talk through the options.",
            ]
        case .cautious:
            [
                "Ask before you run any command that changes files, and before you push or open a PR.",
                "Ask before you run a command that changes files or pushes.",
                nil,
                "Make small, safe changes without asking.",
                "Act on your own judgment. Ask only when you are blocked.",
            ]
        case .formal:
            [
                "Write in a formal, neutral tone.",
                "Write in a plain, professional tone.",
                nil,
                "Use a light, friendly tone.",
                "Be playful. Light humor is welcome.",
            ]
        }
    }

    public func label(_ step: Int) -> String {
        "\(step <= 2 ? left : right) \(step + 1)/5"
    }
}

public struct ToneAxisInfo: Codable, Sendable, Equatable {
    public var key: String
    public var low: String
    public var high: String
    public var steps: [String]
}

public struct MateToneValue: Codable, Sendable, Equatable {
    public var terse: Int?
    public var cautious: Int?
    public var formal: Int?

    public init(terse: Int? = nil, cautious: Int? = nil, formal: Int? = nil) {
        self.terse = terse
        self.cautious = cautious
        self.formal = formal
    }

    subscript(axis: ToneAxis) -> Int? {
        switch axis {
        case .terse: terse
        case .cautious: cautious
        case .formal: formal
        }
    }
}

public struct ToneLine: Sendable, Equatable, Identifiable {
    public var axis: ToneAxis
    public var step: Int
    public var label: String
    public var sentence: String?

    public var id: ToneAxis { axis }
}

public struct MateTones: Sendable, Equatable {
    private var steps: [ToneAxis: Int] = [:]
    private var axes: [String: [String]] = [:]

    public init(axes: [ToneAxisInfo] = []) {
        for info in axes where info.steps.count == 5 {
            self.axes[info.key] = info.steps
        }
    }

    public init(_ value: MateToneValue?, axes: [ToneAxisInfo] = []) {
        self.init(axes: axes)
        for axis in ToneAxis.allCases {
            if let v = value?[axis], (1...5).contains(v) { self[axis] = v - 1 }
        }
    }

    public static func == (a: MateTones, b: MateTones) -> Bool {
        ToneAxis.allCases.allSatisfy { a[$0] == b[$0] }
    }

    public subscript(axis: ToneAxis) -> Int {
        get { steps[axis] ?? 2 }
        set {
            let step = min(4, max(0, newValue))
            steps[axis] = step == 2 ? nil : step
        }
    }

    public var value: MateToneValue? {
        func v(_ axis: ToneAxis) -> Int? { self[axis] == 2 ? nil : self[axis] + 1 }
        let out = MateToneValue(terse: v(.terse), cautious: v(.cautious), formal: v(.formal))
        return out == MateToneValue() ? nil : out
    }

    func sentence(_ axis: ToneAxis, _ step: Int) -> String? {
        if let custom = axes[axis.rawValue] {
            return custom[step].isEmpty ? nil : custom[step]
        }
        return axis.sentences[step]
    }

    public var lines: [ToneLine] {
        ToneAxis.allCases.map { axis in
            let step = self[axis]
            return ToneLine(axis: axis, step: step, label: axis.label(step), sentence: sentence(axis, step))
        }
    }

    public var added: [ToneLine] { lines.filter { $0.sentence != nil } }

    public var chips: [String] { lines.filter { $0.step != 2 }.map(\.label) }
}
