import Foundation

public enum SVGCommand: Sendable, Equatable {
    case move(FacePoint)
    case line(FacePoint)
    case cubic(FacePoint, FacePoint, FacePoint)
    case close
}

public struct SVGPathError: Error, Sendable, Equatable {
    public var message: String
}

public enum SVGPath {
    public static func parse(_ d: String) throws -> [SVGCommand] {
        var tokens = Tokens(d)
        var out: [SVGCommand] = []
        var current = FacePoint(0, 0)
        var start = FacePoint(0, 0)
        var lastControl: FacePoint?
        var command: Character?
        while true {
            let next: Character
            if let c = tokens.peekCommand() {
                tokens.skipCommand()
                next = c
            } else if let c = command, tokens.hasNumber {
                next = c
            } else {
                break
            }
            let relative = next.isLowercase
            let base = relative ? current : FacePoint(0, 0)
            func point() throws -> FacePoint {
                let x = try tokens.number()
                let y = try tokens.number()
                return FacePoint(base.x + x, base.y + y)
            }
            switch next.lowercased() {
            case "m":
                current = try point()
                start = current
                out.append(.move(current))
                command = relative ? "l" : "L"
                lastControl = nil
                continue
            case "l":
                current = try point()
                out.append(.line(current))
                lastControl = nil
            case "h":
                let x = try tokens.number()
                current = FacePoint(relative ? current.x + x : x, current.y)
                out.append(.line(current))
                lastControl = nil
            case "v":
                let y = try tokens.number()
                current = FacePoint(current.x, relative ? current.y + y : y)
                out.append(.line(current))
                lastControl = nil
            case "c":
                let c1 = try point()
                let c2 = try point()
                let end = try point()
                out.append(.cubic(c1, c2, end))
                lastControl = c2
                current = end
            case "s":
                let c1 = lastControl.map { FacePoint(2 * current.x - $0.x, 2 * current.y - $0.y) } ?? current
                let c2 = try point()
                let end = try point()
                out.append(.cubic(c1, c2, end))
                lastControl = c2
                current = end
            case "z":
                out.append(.close)
                current = start
                lastControl = nil
                command = nil
                continue
            default:
                throw SVGPathError(message: "unknown path command \(next)")
            }
            command = next
        }
        guard tokens.atEnd else { throw SVGPathError(message: "bad path data") }
        return out
    }

    struct Tokens {
        let chars: [Character]
        var i = 0

        init(_ s: String) { chars = Array(s) }

        mutating func skipSpace() {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" { i += 1 }
        }

        var atEnd: Bool {
            mutating get { skipSpace(); return i >= chars.count }
        }

        var hasNumber: Bool {
            mutating get {
                skipSpace()
                guard i < chars.count else { return false }
                return chars[i].isNumber || chars[i] == "-" || chars[i] == "." || chars[i] == "+"
            }
        }

        mutating func peekCommand() -> Character? {
            skipSpace()
            guard i < chars.count, chars[i].isLetter else { return nil }
            return chars[i]
        }

        mutating func skipCommand() { i += 1 }

        mutating func number() throws -> Double {
            skipSpace()
            var text = ""
            if i < chars.count, chars[i] == "-" || chars[i] == "+" {
                text.append(chars[i])
                i += 1
            }
            var dot = false
            while i < chars.count, chars[i].isNumber || (chars[i] == "." && !dot) {
                if chars[i] == "." { dot = true }
                text.append(chars[i])
                i += 1
            }
            guard let value = Double(text) else { throw SVGPathError(message: "expected a number") }
            return value
        }
    }
}

public struct SlackPart: Sendable, Equatable {
    public var path: String
    public var color: String
}

public enum SlackMark {
    public static let size = 122.8

    public static let parts: [SlackPart] = [
        SlackPart(path: "M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z", color: "#e01e5a"),
        SlackPart(path: "M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z", color: "#36c5f0"),
        SlackPart(path: "M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z", color: "#2eb67d"),
        SlackPart(path: "M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z", color: "#ecb22e"),
    ]

    public static let commands: [[SVGCommand]] = parts.map { (try? SVGPath.parse($0.path)) ?? [] }
}
