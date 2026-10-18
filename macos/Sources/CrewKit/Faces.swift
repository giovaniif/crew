import Foundation

public enum FaceAccent: String, CaseIterable, Sendable {
    case rosewater, flamingo, pink, mauve, red, peach, yellow, green, teal, sky, sapphire, lavender

    public var light: String {
        switch self {
        case .rosewater: "#dc8a78"
        case .flamingo: "#dd7878"
        case .pink: "#ea76cb"
        case .mauve: "#8839ef"
        case .red: "#d20f39"
        case .peach: "#fe640b"
        case .yellow: "#df8e1d"
        case .green: "#40a02b"
        case .teal: "#179299"
        case .sky: "#04a5e5"
        case .sapphire: "#209fb5"
        case .lavender: "#7287fd"
        }
    }

    public var dark: String {
        switch self {
        case .rosewater: "#f5e0dc"
        case .flamingo: "#f2cdcd"
        case .pink: "#f5c2e7"
        case .mauve: "#cba6f7"
        case .red: "#f38ba8"
        case .peach: "#fab387"
        case .yellow: "#f9e2af"
        case .green: "#a6e3a1"
        case .teal: "#94e2d5"
        case .sky: "#89dceb"
        case .sapphire: "#74c7ec"
        case .lavender: "#b4befe"
        }
    }

    public static let swatches: [FaceAccent] = [
        .mauve, .lavender, .sapphire, .sky, .teal, .green, .yellow, .peach, .red, .pink, .flamingo, .rosewater,
    ]
}

public struct FaceColor: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    public static let ink = FaceColor(red: 0x1e / 255.0, green: 0x1e / 255.0, blue: 0x2e / 255.0)
    public static let attention = FaceColor(red: 0xfe / 255.0, green: 0x64 / 255.0, blue: 0x0b / 255.0)

    public static func rgb(_ hex: String) -> FaceColor? {
        guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return FaceColor(
            red: Double((value >> 16) & 0xff) / 255.0,
            green: Double((value >> 8) & 0xff) / 255.0,
            blue: Double(value & 0xff) / 255.0
        )
    }
}

public enum FaceState: String, CaseIterable, Sendable {
    case idle, thinking, working, needs, paused

    public static func of(state: String, ended: Bool) -> FaceState {
        if ended { return .paused }
        switch state {
        case "running": return .working
        case "permission", "waiting": return .needs
        default: return .idle
        }
    }
}

public struct FacePoint: Sendable, Equatable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }
}

public struct FaceBox: Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum FacePaint: Sendable, Equatable {
    case head(Double)
    case ink(Double)
    case glint(Double)
    case attention
    case background
}

public enum FaceMark: Sendable, Equatable {
    case circle(FacePoint, r: Double, paint: FacePaint)
    case ring(FacePoint, r: Double, width: Double, dash: [Double], paint: FacePaint)
    case rect(FaceBox, radius: Double, rotation: Double, paint: FacePaint)
    case line(FacePoint, FacePoint, width: Double, paint: FacePaint)
    case curve(FacePoint, control: FacePoint, FacePoint, width: Double)
    case triangle(FacePoint, FacePoint, FacePoint)
    case lowerHalfDisc(FacePoint, r: Double)
}

public struct Face: Sendable, Equatable, Identifiable {
    public enum Head: Sendable { case squircle, rounded, circle, diamond }
    public enum Eye: Sendable { case dot, square, happy, visor, cyclops, ring, bar, wink, diamond, sleepy, tall }
    public enum Mouth: Sendable { case smile, flat, dot, beak, wide, smirk, o }

    public var id: String
    public var name: String
    public var accent: FaceAccent
    public var head: Head
    public var eye: Eye
    public var mouth: Mouth
    public var antenna = false

    public static let all: [Face] = [
        Face(id: "pip", name: "Pip", accent: .lavender, head: .squircle, eye: .dot, mouth: .smile),
        Face(id: "bolt", name: "Bolt", accent: .sapphire, head: .rounded, eye: .square, mouth: .flat),
        Face(id: "sage", name: "Sage", accent: .green, head: .circle, eye: .happy, mouth: .dot),
        Face(id: "visor", name: "Visor", accent: .teal, head: .squircle, eye: .visor, mouth: .smile),
        Face(id: "iris", name: "Iris", accent: .mauve, head: .circle, eye: .cyclops, mouth: .flat),
        Face(id: "owl", name: "Owl", accent: .peach, head: .rounded, eye: .ring, mouth: .beak),
        Face(id: "dash", name: "Dash", accent: .sky, head: .squircle, eye: .bar, mouth: .wide),
        Face(id: "wink", name: "Wink", accent: .pink, head: .circle, eye: .wink, mouth: .smirk),
        Face(id: "prism", name: "Prism", accent: .yellow, head: .diamond, eye: .diamond, mouth: .flat),
        Face(id: "moss", name: "Moss", accent: .rosewater, head: .rounded, eye: .sleepy, mouth: .smile),
        Face(id: "beacon", name: "Beacon", accent: .red, head: .squircle, eye: .dot, mouth: .o, antenna: true),
        Face(id: "quill", name: "Quill", accent: .flamingo, head: .circle, eye: .tall, mouth: .smile),
    ]

    public static func named(_ id: String) -> Face? {
        all.first { $0.id == id }
    }

    public static func fallback(for name: String) -> Face {
        var hash: UInt32 = 5381
        for byte in name.utf8 { hash = hash &* 33 &+ UInt32(byte) }
        return all[Int(hash % UInt32(all.count))]
    }

    public func symbol(_ state: FaceState) -> String {
        "crew-face-\(id)-\(state.rawValue)"
    }

    public func marks(_ state: FaceState) -> [FaceMark] {
        var out = [headMark(state == .paused ? 0.45 : 1)]
        if antenna {
            out.append(.line(FacePoint(12, 0), FacePoint(12, -2.4), width: 1.6, paint: .head(1)))
            out.append(.circle(FacePoint(12, -2.6), r: 1.4, paint: .head(1)))
        }
        let shift = state == .thinking ? (0.9, -0.9) : (0.0, 0.0)
        out += eyes(state, dx: shift.0, dy: shift.1)
        out += mouthMarks(state)
        out += ring(state)
        return out
    }

    private func headMark(_ opacity: Double) -> FaceMark {
        switch head {
        case .circle: .circle(FacePoint(12, 12), r: 12, paint: .head(opacity))
        case .rounded: .rect(FaceBox(0, 0, 24, 24), radius: 5, rotation: 0, paint: .head(opacity))
        case .diamond: .rect(FaceBox(2, 2, 20, 20), radius: 5, rotation: 45, paint: .head(opacity))
        case .squircle: .rect(FaceBox(0, 0, 24, 24), radius: 8, rotation: 0, paint: .head(opacity))
        }
    }

    private func eyes(_ state: FaceState, dx: Double, dy: Double) -> [FaceMark] {
        let y = 10.5 + dy
        if state == .paused {
            return [
                .line(FacePoint(6.8, y + 0.5), FacePoint(10.2, y + 0.5), width: 1.6, paint: .ink(1)),
                .line(FacePoint(13.8, y + 0.5), FacePoint(17.2, y + 0.5), width: 1.6, paint: .ink(1)),
            ]
        }
        let k = state == .needs ? 1.2 : 1.0
        switch eye {
        case .visor:
            return [
                .rect(FaceBox(6 + dx, y - 1.5 * k, 12, 3 * k), radius: 1.5, rotation: 0, paint: .ink(1)),
                .rect(FaceBox(13 + dx * 2, y - 0.6, 3, 1.2), radius: 0.6, rotation: 0, paint: .glint(0.7)),
            ]
        case .cyclops:
            return [
                .circle(FacePoint(12 + dx, y), r: 3.6 * k, paint: .ink(1)),
                .circle(FacePoint(13 + dx, y - 1), r: 1.1, paint: .glint(0.8)),
            ]
        default:
            break
        }
        var out: [FaceMark] = []
        for (i, base) in [8.5, 15.5].enumerated() {
            let x = base + dx
            switch eye {
            case .dot:
                out.append(.circle(FacePoint(x, y), r: 1.7 * k, paint: .ink(1)))
            case .square:
                out.append(.rect(FaceBox(x - 1.6 * k, y - 1.6 * k, 3.2 * k, 3.2 * k), radius: 0.6, rotation: 0, paint: .ink(1)))
            case .happy:
                out.append(.curve(FacePoint(x - 2, y + 1), control: FacePoint(x, y - 2), FacePoint(x + 2, y + 1), width: 1.6))
            case .ring:
                out.append(.ring(FacePoint(x, y), r: 2.6 * k, width: 1.3, dash: [], paint: .ink(1)))
                out.append(.circle(FacePoint(x + 0.5, y), r: 1, paint: .ink(1)))
            case .bar:
                out.append(.rect(FaceBox(x - 0.9, y - 2.4 * k, 1.8, 4.8 * k), radius: 0.9, rotation: 0, paint: .ink(1)))
            case .tall:
                out.append(.rect(FaceBox(x - 1.4, y - 2.2 * k, 2.8, 4.4 * k), radius: 1.4, rotation: 0, paint: .ink(1)))
            case .diamond:
                out.append(.rect(FaceBox(x - 1.3 * k, y - 1.3 * k, 2.6 * k, 2.6 * k), radius: 0, rotation: 45, paint: .ink(1)))
            case .sleepy:
                out.append(.lowerHalfDisc(FacePoint(x, y - 0.5), r: 2))
            case .wink:
                out.append(i == 0
                    ? .circle(FacePoint(x, y), r: 1.7 * k, paint: .ink(1))
                    : .line(FacePoint(x - 1.8, y), FacePoint(x + 1.8, y), width: 1.6, paint: .ink(1)))
            case .visor, .cyclops:
                break
            }
        }
        return out
    }

    private func mouthMarks(_ state: FaceState) -> [FaceMark] {
        let y = 16.2
        switch state {
        case .needs: return [.circle(FacePoint(12, y + 0.3), r: 1.6, paint: .ink(1))]
        case .thinking: return [.line(FacePoint(10.5, y), FacePoint(13.5, y), width: 1.6, paint: .ink(1))]
        case .paused: return [.line(FacePoint(10.5, y), FacePoint(13.5, y), width: 1.6, paint: .ink(0.7))]
        case .idle, .working: break
        }
        switch mouth {
        case .smile: return [.curve(FacePoint(9.5, y - 0.6), control: FacePoint(12, y + 1.8), FacePoint(14.5, y - 0.6), width: 1.6)]
        case .flat: return [.line(FacePoint(10, y), FacePoint(14, y), width: 1.6, paint: .ink(1))]
        case .dot: return [.circle(FacePoint(12, y), r: 1, paint: .ink(1))]
        case .beak: return [.triangle(FacePoint(10.6, y - 1.2), FacePoint(13.4, y - 1.2), FacePoint(12, y + 0.8))]
        case .wide: return [.curve(FacePoint(8.5, y - 1), control: FacePoint(12, y + 2.2), FacePoint(15.5, y - 1), width: 1.6)]
        case .smirk: return [.curve(FacePoint(10.5, y), control: FacePoint(12.7, y + 1), FacePoint(14.5, y - 1), width: 1.6)]
        case .o: return [.ring(FacePoint(12, y), r: 1.3, width: 1.4, dash: [], paint: .ink(1))]
        }
    }

    private func ring(_ state: FaceState) -> [FaceMark] {
        let center = FacePoint(12, 12)
        switch state {
        case .thinking: return [.ring(center, r: 14.2, width: 1.4, dash: [0.1, 3.6], paint: .head(1))]
        case .working: return [.ring(center, r: 14.2, width: 1.6, dash: [22, 67], paint: .head(1))]
        case .needs:
            return [
                .ring(center, r: 14.2, width: 1.8, dash: [], paint: .attention),
                .circle(FacePoint(22, 2), r: 3.2, paint: .attention),
                .ring(FacePoint(22, 2), r: 3.2, width: 1.4, dash: [], paint: .background),
            ]
        case .idle, .paused: return []
        }
    }
}

public struct MateLook: Sendable, Equatable {
    public var face: Face
    public var color: String

    public init(face: Face, color: String) {
        self.face = face
        self.color = color
    }

    public static func of(name: String, avatar: String?, color: String?) -> MateLook {
        let face = avatar.flatMap(Face.named) ?? Face.fallback(for: name)
        let hex = color.flatMap { FaceColor.rgb($0) == nil ? nil : $0 } ?? face.accent.light
        return MateLook(face: face, color: hex)
    }

    public static func of(_ definition: MateDefinition) -> MateLook {
        of(name: definition.name, avatar: definition.avatar, color: definition.color)
    }
}
