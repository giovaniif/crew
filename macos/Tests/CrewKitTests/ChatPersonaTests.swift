import Foundation
import Testing
@testable import CrewKit

struct ChatPersonaTests {
    func session(_ id: String) throws -> Session {
        try #require(Seed.mates.sessions.first { $0.id == id })
    }

    @Test func aMateSessionUsesTheMateNameAndFace() throws {
        let persona = ChatPersona.of(session: try session("m3"), board: Seed.mates.mates)
        #expect(persona.name == "Bolt")
        #expect(persona.look == MateLook.of(name: "bolt", avatar: nil, color: nil))
        #expect(persona.state == .working)
    }

    @Test func theAvatarAndColorOfTheBoardRowWin() throws {
        let board = MateBoard(mates: [MateRow(name: "bolt", state: "ready", avatar: "owl", color: "#112233")])
        let persona = ChatPersona.of(session: try session("m3"), board: board)
        #expect(persona.look?.face.id == "owl")
        #expect(persona.look?.color == "#112233")
    }

    @Test func aSessionWithoutAMateIsTheAgentWithNoFace() throws {
        let persona = ChatPersona.of(session: try session("s4"), board: Seed.mates.mates)
        #expect(persona.name == "The agent")
        #expect(persona.look == nil)
    }

    @Test func pausedWinsOverNeedsYouAndNeedsYouOverWorking() throws {
        let paused = MateBoard(mates: [MateRow(name: "iris", state: "paused")])
        #expect(ChatPersona.of(session: try session("m2"), board: paused).state == .paused)
        #expect(ChatPersona.of(session: try session("m2"), board: MateBoard(stopped: true)).state == .paused)
        #expect(ChatPersona.of(session: try session("m2"), board: nil).state == .needs)
        #expect(ChatPersona.of(session: try session("m1"), board: nil).state == .working)
        #expect(ChatPersona.of(session: try session("m5"), board: nil).state == .idle)
    }
}
