#if canImport(SwiftUI)
import CrewKit
import SwiftUI

extension FaceColor {
    var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }
}

public struct MateFace: View {
    let look: MateLook
    let state: FaceState
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme
    @Environment(\.crewAnimates) private var animates

    public init(look: MateLook, state: FaceState = .idle, size: CGFloat = 40) {
        self.look = look
        self.state = state
        self.size = size
    }

    public var body: some View {
        Group {
            if animates, state == .working || state == .thinking {
                TimelineView(.animation) { context in
                    canvas(spin: context.date.timeIntervalSinceReferenceDate * (state == .working ? 300 : 90))
                }
            } else {
                canvas(spin: 0)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("\(look.face.name), \(state.rawValue)")
    }

    private var head: Color {
        if look.color == look.face.accent.light, scheme == .dark {
            return Color(hex: look.face.accent.dark)
        }
        return FaceColor.rgb(look.color)?.color ?? Color(hex: look.face.accent.light)
    }

    private func canvas(spin: Double) -> some View {
        let marks = look.face.marks(state)
        let headColor = self.head
        let background = scheme == .dark ? Color(white: 0.12) : Color.white
        return Canvas { ctx, canvasSize in
            let scale = canvasSize.width / 32
            func p(_ point: FacePoint) -> CGPoint { CGPoint(x: (point.x + 4) * scale, y: (point.y + 4) * scale) }
            func paint(_ p: FacePaint) -> GraphicsContext.Shading {
                switch p {
                case let .head(o): .color(headColor.opacity(o))
                case let .ink(o): .color(FaceColor.ink.color.opacity(o))
                case let .glint(o): .color(Color.white.opacity(o))
                case .attention: .color(FaceColor.attention.color)
                case .background: .color(background)
                }
            }
            for mark in marks {
                switch mark {
                case let .circle(c, r, fill):
                    let o = p(c)
                    ctx.fill(Path(ellipseIn: CGRect(x: o.x - r * scale, y: o.y - r * scale, width: 2 * r * scale, height: 2 * r * scale)), with: paint(fill))
                case let .ring(c, r, width, dash, stroke):
                    let o = p(c)
                    var path = Path(ellipseIn: CGRect(x: o.x - r * scale, y: o.y - r * scale, width: 2 * r * scale, height: 2 * r * scale))
                    if !dash.isEmpty, spin != 0 {
                        path = path.applying(CGAffineTransform(translationX: -o.x, y: -o.y).concatenating(CGAffineTransform(rotationAngle: spin * .pi / 180)).concatenating(CGAffineTransform(translationX: o.x, y: o.y)))
                    }
                    ctx.stroke(path, with: paint(stroke), style: StrokeStyle(lineWidth: width * scale, lineCap: dash.isEmpty ? .butt : .round, dash: dash.map { $0 * scale }))
                case let .rect(box, radius, rotation, fill):
                    let origin = p(FacePoint(box.x, box.y))
                    let rect = CGRect(x: origin.x, y: origin.y, width: box.width * scale, height: box.height * scale)
                    var path = Path(roundedRect: rect, cornerRadius: radius * scale)
                    if rotation != 0 {
                        let mid = CGPoint(x: rect.midX, y: rect.midY)
                        path = path.applying(CGAffineTransform(translationX: -mid.x, y: -mid.y).concatenating(CGAffineTransform(rotationAngle: rotation * .pi / 180)).concatenating(CGAffineTransform(translationX: mid.x, y: mid.y)))
                    }
                    ctx.fill(path, with: paint(fill))
                case let .line(a, b, width, stroke):
                    var path = Path()
                    path.move(to: p(a))
                    path.addLine(to: p(b))
                    ctx.stroke(path, with: paint(stroke), style: StrokeStyle(lineWidth: width * scale, lineCap: .round))
                case let .curve(a, control, b, width):
                    var path = Path()
                    path.move(to: p(a))
                    path.addQuadCurve(to: p(b), control: p(control))
                    ctx.stroke(path, with: paint(.ink(1)), style: StrokeStyle(lineWidth: width * scale, lineCap: .round))
                case let .triangle(a, b, c):
                    var path = Path()
                    path.move(to: p(a))
                    path.addLine(to: p(b))
                    path.addLine(to: p(c))
                    path.closeSubpath()
                    ctx.fill(path, with: paint(.ink(1)))
                case let .lowerHalfDisc(c, r):
                    var path = Path()
                    path.addArc(center: p(c), radius: r * scale, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
                    path.closeSubpath()
                    ctx.fill(path, with: paint(.ink(1)))
                }
            }
        }
    }
}

public struct SlackLogo: View {
    let size: CGFloat

    public init(size: CGFloat = 16) {
        self.size = size
    }

    public var body: some View {
        Canvas { ctx, canvasSize in
            let scale = canvasSize.width / SlackMark.size
            for (part, commands) in zip(SlackMark.parts, SlackMark.commands) {
                var path = Path()
                func p(_ point: FacePoint) -> CGPoint { CGPoint(x: point.x * scale, y: point.y * scale) }
                for command in commands {
                    switch command {
                    case let .move(a): path.move(to: p(a))
                    case let .line(a): path.addLine(to: p(a))
                    case let .cubic(c1, c2, end): path.addCurve(to: p(end), control1: p(c1), control2: p(c2))
                    case .close: path.closeSubpath()
                    }
                }
                ctx.fill(path, with: .color(Color(hex: part.color)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Slack")
    }
}

public struct SlackButton: View {
    let title: String
    let action: () -> Void

    public init(_ title: String = "Connect to Slack…", action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                SlackLogo(size: 14)
                Text(title)
            }
        }
    }
}
#endif
