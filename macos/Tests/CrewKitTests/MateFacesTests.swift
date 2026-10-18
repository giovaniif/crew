import Foundation
import Testing
@testable import CrewKit

struct MateFacesTests {
    static func asset(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources").appendingPathComponent(name)
        return try String(contentsOf: url, encoding: .utf8)
    }

    @Test func theAppShipsOneSymbolForEachFaceAndState() throws {
        let svg = try Self.asset("faces.svg")
        let ids = svg.components(separatedBy: "<symbol id=\"").dropFirst().map { $0.prefix { $0 != "\"" } }.map(String.init)
        let expected = Face.all.flatMap { face in FaceState.allCases.map { face.symbol($0) } }
        #expect(ids.count == 60)
        #expect(Set(ids) == Set(expected))
    }

    @Test func eachFaceHasTheAccentOfTheAsset() throws {
        let svg = try Self.asset("faces.svg")
        for face in Face.all {
            #expect(svg.contains("id=\"\(face.symbol(.idle))\" viewBox=\"-4 -4 32 32\" data-light=\"\(face.accent.light)\" data-dark=\"\(face.accent.dark)\""))
        }
    }

    @Test func twelveFacesWithUniqueIdsAndNames() {
        #expect(Face.all.count == 12)
        #expect(Set(Face.all.map(\.id)).count == 12)
        #expect(Face.named("iris")?.name == "Iris")
        #expect(Face.named("ghost") == nil)
        #expect(FaceAccent.swatches.count == 12)
        #expect(FaceAccent.swatches.first == .mauve)
    }

    @Test func aSessionStateGivesTheFaceState() {
        #expect(FaceState.of(state: "running", ended: false) == .working)
        #expect(FaceState.of(state: "permission", ended: false) == .needs)
        #expect(FaceState.of(state: "waiting", ended: false) == .needs)
        #expect(FaceState.of(state: "done", ended: false) == .idle)
        #expect(FaceState.of(state: "idle", ended: false) == .idle)
        #expect(FaceState.of(state: "running", ended: true) == .paused)
    }

    @Test func aMateWithNoAvatarGetsTheSameFaceEachTime() {
        let a = MateLook.of(name: "reviewer", avatar: nil, color: nil)
        let b = MateLook.of(name: "reviewer", avatar: nil, color: nil)
        #expect(a == b)
        #expect(Face.all.contains(a.face))
        #expect(a.color == a.face.accent.light)
    }

    @Test func theAvatarAndColorOfTheMateWin() {
        let look = MateLook.of(name: "x", avatar: "owl", color: "#123456")
        #expect(look.face.id == "owl")
        #expect(look.color == "#123456")
        #expect(MateLook.of(name: "x", avatar: "nope", color: "bad").color == MateLook.of(name: "x", avatar: "nope", color: nil).color)
    }

    @Test func theHexOfAColorGivesItsComponents() {
        #expect(FaceColor.rgb("#ff8000") == FaceColor(red: 1, green: 128.0 / 255, blue: 0))
        #expect(FaceColor.rgb("orange") == nil)
    }

    @Test func thinkingMovesTheEyesUpAndToTheRight() {
        let iris = Face.named("iris")!
        #expect(iris.marks(.idle).contains(.circle(FacePoint(12, 10.5), r: 3.6, paint: .ink(1))))
        #expect(iris.marks(.thinking).contains(.circle(FacePoint(12.9, 9.6), r: 3.6, paint: .ink(1))))
        #expect(iris.marks(.thinking).contains(.ring(FacePoint(12, 12), r: 14.2, width: 1.4, dash: [0.1, 3.6], paint: .head(1))))
    }

    @Test func needsShowsTheAttentionRingAndBadge() {
        let pip = Face.named("pip")!
        let marks = pip.marks(.needs)
        #expect(marks.contains(.ring(FacePoint(12, 12), r: 14.2, width: 1.8, dash: [], paint: .attention)))
        #expect(marks.contains(.circle(FacePoint(22, 2), r: 3.2, paint: .attention)))
        #expect(marks.contains(.circle(FacePoint(8.5, 10.5), r: 1.7 * 1.2, paint: .ink(1))))
    }

    @Test func pausedDimsTheHeadAndClosesTheEyes() {
        let bolt = Face.named("bolt")!
        let marks = bolt.marks(.paused)
        #expect(marks.first == .rect(FaceBox(0, 0, 24, 24), radius: 5, rotation: 0, paint: .head(0.45)))
        #expect(marks.contains(.line(FacePoint(6.8, 11), FacePoint(10.2, 11), width: 1.6, paint: .ink(1))))
        #expect(marks.contains(.line(FacePoint(10.5, 16.2), FacePoint(13.5, 16.2), width: 1.6, paint: .ink(0.7))))
    }

    @Test func beaconHasAnAntenna() {
        let marks = Face.named("beacon")!.marks(.idle)
        #expect(marks.contains(.circle(FacePoint(12, -2.6), r: 1.4, paint: .head(1))))
        #expect(!Face.named("pip")!.marks(.idle).contains(.circle(FacePoint(12, -2.6), r: 1.4, paint: .head(1))))
    }
}
