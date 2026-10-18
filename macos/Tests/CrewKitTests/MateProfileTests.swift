import Foundation
import Testing
@testable import CrewKit

@MainActor
struct MateProfileTests {
    static var crew: ViewState { Seed.mates }

    @Test func aSessionOfAMateDecodesItsSeat() throws {
        let json = #"{"Name":"iris","Owner":"","Authority":"","Local":true}"#
        let seat = try JSONDecoder().decode(SessionMate.self, from: Data(json.utf8))
        #expect(seat == SessionMate(name: "iris", local: true))
        let slack = try JSONDecoder().decode(SessionMate.self, from: Data(#"{"Name":"bolt","Owner":"U1","Authority":"owner"}"#.utf8))
        #expect(slack.local == false)
        #expect(Self.crew.sessions.first { $0.id == "m1" }?.mate?.name == "iris")
        #expect(Seed.window.sessions.allSatisfy { $0.mate == nil })
    }

    @Test func theConversationsOfAMateAreLiveThenPast() {
        let c = MateConversations(state: Self.crew, mate: "iris")
        #expect(c.live.map(\.id) == ["m1", "m2"])
        #expect(c.past.map(\.id) == ["m6"])
        #expect(c.live.first?.status == "Working")
        #expect(c.live.last?.status == "Needs you")
        #expect(c.past.first?.status == "Ended")
        #expect(c.live.first?.where == "api@42-login-redirect")
        #expect(c.live.first?.face == .working)
        #expect(c.live.last?.face == .needs)
        #expect(c.repo(of: "m1") == "api")
    }

    @Test func theMemoryMeterCountsBytesAgainstTheLimit() {
        let meter = MemoryMeter(text: String(repeating: "a", count: 3_174), limit: 8_192)
        #expect(meter.label == "3.1 KB of 8 KB")
        #expect(abs(meter.fraction - 3_174.0 / 8_192.0) < 0.0001)
        #expect(!meter.full)
        #expect(MemoryMeter(text: "", limit: 8_192).label == "Empty · 8 KB limit")
        #expect(MemoryMeter(text: "hé", limit: 8_192).label == "3 bytes of 8 KB")
        #expect(MemoryMeter(text: String(repeating: "a", count: 9_000), limit: 8_192).fraction == 1)
        #expect(MemoryMeter(text: String(repeating: "a", count: 9_000), limit: 8_192).full)
    }

    @Test func theNotesAreTheLinesOfTheMemory() {
        #expect(MemoryNotes.notes("# Notes\n\n- web uses pnpm.\n* Small PRs.\nplain line\n") == ["web uses pnpm.", "Small PRs.", "plain line"])
        #expect(MemoryNotes.notes("") == [])
    }

    @Test func theProfileReadsAndWritesTheMemory() async {
        let caller = FakeCaller()
        caller.replies["mate.memory"] = .success(#"{"name":"iris","path":"/h/mates/iris/memory.md","text":"- a\n","limit":8192}"#)
        caller.replies["mate.set_memory"] = .success(#"{"name":"iris","path":"/h/mates/iris/memory.md","text":"- b\n","limit":8192}"#)
        let model = MatesModel(caller: caller)
        await model.loadMemory("iris")
        #expect(model.memory["iris"]?.text == "- a\n")
        #expect(model.memory["iris"]?.limit == 8192)
        #expect(caller.calls.last?.params["name"] as? String == "iris")
        #expect(await model.saveMemory("iris", text: "- b\n"))
        #expect(caller.calls.last?.method == "mate.set_memory")
        #expect(caller.calls.last?.params["text"] as? String == "- b\n")
        #expect(model.memory["iris"]?.text == "- b\n")
        caller.replies["mate.set_memory"] = .success(#"{"name":"iris","path":"/h/mates/iris/memory.md","text":"","limit":8192}"#)
        await model.clearMemory("iris")
        #expect(caller.calls.last?.params["text"] as? String == "")
        #expect(model.memory["iris"]?.text == "")
    }

    @Test func aTooLargeMemoryIsRefusedWithTheMessageOfTheDaemon() async {
        let caller = FakeCaller()
        caller.replies["mate.set_memory"] = .failure(RPCError(code: "bad_request", message: "the memory is 9000 bytes; the limit is 8192 bytes"))
        let model = MatesModel(caller: caller)
        #expect(await model.saveMemory("iris", text: "x") == false)
        #expect(model.message?.contains("8192") == true)
    }

    @Test func newConversationCallsMateNewAndGivesTheSession() async {
        let caller = FakeCaller()
        caller.replies["mate.new"] = .success(#"{"ID":"s9","Harness":"claude"}"#)
        let model = MatesModel(caller: caller)
        let id = await model.newConversation("iris", repo: "web")
        #expect(id == "s9")
        #expect(caller.calls.last?.method == "mate.new")
        #expect(caller.calls.last?.params["name"] as? String == "iris")
        #expect(caller.calls.last?.params["repo"] as? String == "web")
        _ = await model.newConversation("iris")
        #expect(caller.calls.last?.params["repo"] == nil)
    }

    @Test func startFreshAsksForAHandoffThenStartsANewConversationInTheSameRepo() async {
        let caller = FakeCaller()
        caller.replies["session.send"] = .success(#"{"queued":false}"#)
        caller.replies["mate.new"] = .success(#"{"ID":"s10"}"#)
        let model = MatesModel(caller: caller)
        let session = Self.crew.sessions.first { $0.id == "m1" }!
        let id = await model.startFresh(session, state: Self.crew)
        #expect(id == "s10")
        #expect(caller.methods() == ["session.send", "mate.new"])
        #expect(caller.calls[0].params["session"] as? String == "m1")
        #expect((caller.calls[0].params["text"] as? String)?.contains("memory file") == true)
        #expect(caller.calls[1].params["name"] as? String == "iris")
        #expect(caller.calls[1].params["repo"] as? String == "api")
    }

    @Test func startFreshStopsWhenTheHandoffFails() async {
        let caller = FakeCaller()
        caller.replies["session.send"] = .failure(RPCError(code: "not_found", message: "no session"))
        let model = MatesModel(caller: caller)
        let session = Self.crew.sessions.first { $0.id == "m1" }!
        #expect(await model.startFresh(session, state: Self.crew) == nil)
        #expect(caller.methods() == ["session.send"])
        #expect(model.message == "no session")
        let plain = Seed.window.sessions[0]
        #expect(await model.startFresh(plain, state: Seed.window) == nil)
    }

    @Test func theGalleryShowsACardForEachMate() {
        let gallery = MateGallery(definitions: Seed.mateDefinitions, state: Self.crew)
        #expect(gallery.cards.map(\.name) == ["iris", "bolt", "sage", "owl", "pip"])
        #expect(gallery.summary == "5 mates · 6 live")
        let iris = gallery.cards[0]
        #expect(iris.display == "Iris")
        #expect(iris.look.face.id == "iris")
        #expect(iris.live == 2)
        #expect(iris.liveLabel == "2 live")
        #expect(iris.brains == "Claude · opus · high")
        #expect(iris.repos == ["api", "web"])
        #expect(iris.tagline == "Careful reviewer. Reads every line, asks before it guesses.")
        #expect(iris.status == MateStatusLine(state: "permission", text: "Needs you", face: .needs))
        let sage = gallery.cards[2]
        #expect(sage.liveLabel == "No live chats")
        #expect(sage.status.text == "Idle")
        #expect(gallery.cards[1].status.text == "Working on fix flaky login test")
    }

    @Test func theGalleryFiltersBySourceAndSearch() {
        var gallery = MateGallery(definitions: Seed.mateDefinitions, state: Self.crew)
        #expect(gallery.count(.all) == 5)
        #expect(gallery.count(.live) == 4)
        #expect(gallery.count(.agent("claude")) == 3)
        #expect(gallery.count(.agent("codex")) == 2)
        gallery.filter = .live
        #expect(gallery.shown.map(\.name) == ["iris", "bolt", "owl", "pip"])
        gallery.filter = .agent("codex")
        #expect(gallery.shown.map(\.name) == ["bolt", "pip"])
        gallery.filter = .all
        gallery.search = "flake"
        #expect(gallery.shown.map(\.name) == ["pip"])
        gallery.search = "OW"
        #expect(gallery.shown.map(\.name) == ["owl"])
    }

    @Test func aPausedMateSaysSo() {
        var defs = Seed.mateDefinitions
        defs[2].enabled = false
        let gallery = MateGallery(definitions: defs, state: Self.crew)
        #expect(gallery.cards[2].status == MateStatusLine(state: "idle", text: "Paused", face: .paused))
    }

    @Test func theListOfTheDaemonCarriesTheToneAxes() async {
        let caller = FakeCaller()
        caller.replies["mate.list"] = .success(#"{"mates":[],"tones":[{"key":"terse","low":"Terse","high":"Chatty","steps":["a","b","","d","e"]}],"limits":{}}"#)
        caller.replies["approval.list"] = .success("[]")
        let model = MatesModel(caller: caller)
        await model.load()
        #expect(model.tones.map(\.key) == ["terse"])
    }

    @Test func aBoardRowCarriesTheAvatarAndTheConversations() throws {
        let json = #"{"name":"iris","state":"ready","avatar":"owl","work":[],"threads":[],"conversations":[{"session":"s1","name":"review","state":"running","ended":false,"started_at":"2026-10-18T10:00:00Z"}]}"#
        let row = try JSONDecoder().decode(MateRow.self, from: Data(json.utf8))
        #expect(row.avatar == "owl")
        #expect(row.conversations?.map(\.session) == ["s1"])
    }

    @Test func theSidebarEntrySumsUpTheCrew() {
        let entry = MatesEntry(state: Self.crew)
        #expect(entry.names == ["iris", "bolt", "sage", "owl", "pip"])
        #expect(entry.label == "5 · 6 live")
        #expect(MatesEntry(state: Seed.window).label == "Add a mate")
    }

    @Test func sidebarRowsOfAMateCarryItsNameAndFace() {
        let sidebar = Sidebar(state: Self.crew)
        let row = sidebar.rows.first { $0.id == "m1" }!
        #expect(row.mate == "iris")
        #expect(row.face == .working)
        #expect(row.name == "review api #42 login redirect")
        #expect(sidebar.rows.first { $0.id == "s4" }?.mate == nil)
    }

    @Test func theToolbarOfAMateSessionOffersStartFresh() {
        let session = Self.crew.sessions.first { $0.id == "m1" }!
        #expect(StartFresh.offered(session))
        #expect(!StartFresh.offered(Seed.window.sessions[0]))
        #expect(StartFresh.title("iris") == "Start fresh with Iris?")
        #expect(StartFresh.detail("iris").contains("handoff"))
    }

    @Test func aNameShowsWithACapital() {
        #expect(MateNames.display("iris") == "Iris")
        #expect(MateNames.display("reviewer-bot") == "Reviewer bot")
        #expect(MateNames.slug("Reviewer Bot") == "reviewer-bot")
        #expect(MateNames.slug("  Ünï 2 ") == "uni-2")
        #expect(MateNames.valid("iris"))
        #expect(!MateNames.valid(""))
        #expect(!MateNames.valid("-x"))
        #expect(!MateNames.valid(String(repeating: "a", count: 33)))
    }

    @Test func theDefinitionKeepsAvatarAndColor() throws {
        let json = ##"{"name":"iris","prompt":"x","agent":"claude","avatar":"iris","color":"#8839ef","tone":{"terse":2},"no_memory":true,"enabled":true}"##
        let def = try JSONDecoder().decode(MateDefinition.self, from: Data(json.utf8))
        #expect(def.avatar == "iris")
        #expect(def.color == "#8839ef")
        #expect(def.tone == MateToneValue(terse: 2))
        #expect(def.noMemory == true)
        let out = try JSONSerialization.jsonObject(with: JSONEncoder().encode(def)) as? [String: Any]
        #expect(out?["avatar"] as? String == "iris")
        #expect(out?["no_memory"] as? Bool == true)
        #expect(out?["tone"] as? [String: Int] == ["terse": 2])
    }
}
