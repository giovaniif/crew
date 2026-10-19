import Foundation
import Testing
@testable import CrewKit

struct SlackMarkTests {
    @Test func theMarkIsTheOfficialSlackAsset() throws {
        let svg = try MateFacesTests.asset("slack-mark.svg")
        for part in SlackMark.parts {
            #expect(svg.contains("<path d=\"\(part.path)\" fill=\"\(part.color)\"/>"))
        }
        #expect(SlackMark.parts.map(\.color) == ["#e01e5a", "#36c5f0", "#2eb67d", "#ecb22e"])
        #expect(svg.contains("viewBox=\"0 0 \(SlackMark.size) \(SlackMark.size)\""))
    }

    @Test func eachPartParsesIntoClosedShapes() throws {
        for part in SlackMark.parts {
            let commands = try SVGPath.parse(part.path)
            #expect(commands.filter { $0 == .close }.count == 2)
        }
    }

    @Test func relativeAndShorthandCurvesBecomeAbsolute() throws {
        let commands = try SVGPath.parse("M10 10c0 5 5 10 10 10s10-5 10-10h5v5H0V0zm1 1l2 2")
        #expect(commands == [
            .move(FacePoint(10, 10)),
            .cubic(FacePoint(10, 15), FacePoint(15, 20), FacePoint(20, 20)),
            .cubic(FacePoint(25, 20), FacePoint(30, 15), FacePoint(30, 10)),
            .line(FacePoint(35, 10)),
            .line(FacePoint(35, 15)),
            .line(FacePoint(0, 15)),
            .line(FacePoint(0, 0)),
            .close,
            .move(FacePoint(11, 11)),
            .line(FacePoint(13, 13)),
        ])
    }

    @Test func aBadPathIsAnError() {
        #expect(throws: SVGPathError.self) { try SVGPath.parse("M10 10 q1") }
    }
}
