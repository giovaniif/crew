import Foundation
import Testing
@testable import CrewKit

func chatPage(_ messages: [String], before: Int64 = 0) -> String {
    #"{"messages":["# + messages.joined(separator: ",") + #"],"before":"# + String(before) + "}"
}

func chatMessage(_ id: String, _ cursor: Int64, _ role: String, _ text: String = "", tool: String? = nil) -> String {
    let t = tool.map { #","tool":"# + $0 } ?? ""
    return #"{"id":""# + id + #"","cursor":"# + String(cursor) + #","role":""# + role + #"","text":""# + text + #"""# + t + #","at":"2026-10-18T14:02:00Z"}"#
}

func decodeChatPage(_ json: String) throws -> TranscriptPageReply {
    try JSONDecoder().decode(TranscriptPageReply.self, from: Data(json.utf8))
}

struct ChatLogTests {
    @Test func messagesBecomeOwnerAgentToolAndNoteRows() throws {
        var log = ChatLog()
        log.newest(try decodeChatPage(chatPage([
            chatMessage("u1", 10, "user", "The login test fails"),
            chatMessage("a1", 20, "assistant", "Found it"),
            chatMessage("t1", 30, "tool", tool: #"{"name":"Bash","summary":"Bash go test ./auth","status":"done"}"#),
            chatMessage("t2", 31, "tool", tool: #"{"name":"Bash","summary":"Bash git push","status":"running"}"#),
            chatMessage("t3", 32, "tool", "exit 1", tool: #"{"name":"Edit","status":"failed"}"#),
            chatMessage("s1", 40, "system", "Compacted"),
            chatMessage("a2", 50, "assistant", ""),
        ])))
        #expect(log.rows == [
            .owner(id: "u1", text: "The login test fails"),
            .agent(id: "a1", text: "Found it"),
            .tool(id: "t1", mark: "✓", summary: "Bash go test ./auth", failed: false),
            .tool(id: "t2", mark: "◐", summary: "Bash git push", failed: false),
            .tool(id: "t3", mark: "✗", summary: "Edit", failed: true),
            .note(id: "s1", text: "Compacted"),
        ])
    }

    @Test func aNullPageIsEmpty() throws {
        var log = ChatLog()
        log.newest(try decodeChatPage(#"{"messages":null,"before":0}"#))
        #expect(log.rows.isEmpty)
        #expect(!log.hasOlder)
    }

    @Test func aNewerReadUpdatesAToolInPlaceAndAppendsNewMessages() throws {
        var log = ChatLog()
        log.newest(try decodeChatPage(chatPage([
            chatMessage("u1", 10, "user", "go"),
            chatMessage("t1", 20, "tool", tool: #"{"name":"Bash","status":"running"}"#),
        ])))
        log.newest(try decodeChatPage(chatPage([
            chatMessage("t1", 20, "tool", tool: #"{"name":"Bash","status":"done"}"#),
            chatMessage("a1", 30, "assistant", "ok"),
        ])))
        #expect(log.rows == [
            .owner(id: "u1", text: "go"),
            .tool(id: "t1", mark: "✓", summary: "Bash", failed: false),
            .agent(id: "a1", text: "ok"),
        ])
    }

    @Test func anOlderPageGoesAboveAndMovesTheCursor() throws {
        var log = ChatLog()
        log.newest(try decodeChatPage(chatPage([chatMessage("a2", 300, "assistant", "two")], before: 300)))
        #expect(log.hasOlder)
        #expect(log.before == 300)
        log.older(try decodeChatPage(chatPage([chatMessage("u1", 100, "user", "one")], before: 0)))
        #expect(log.rows == [.owner(id: "u1", text: "one"), .agent(id: "a2", text: "two")])
        #expect(!log.hasOlder)
    }

    @Test func theEarlierConversationGoesAboveAHandoffDivider() throws {
        var log = ChatLog()
        log.handoff(from: try decodeChatPage(chatPage([chatMessage("u1", 10, "user", "old")])))
        log.newest(try decodeChatPage(chatPage([chatMessage("u2", 10, "user", "new")])))
        #expect(log.rows == [.owner(id: "u1", text: "old"), .handoff(id: "handoff"), .owner(id: "u2", text: "new")])
    }

    @Test func aSessionThatIsNotAStartFreshHasNoDivider() throws {
        var log = ChatLog()
        log.newest(try decodeChatPage(chatPage([chatMessage("u1", 10, "user", "old")])))
        log.newest(try decodeChatPage(chatPage([chatMessage("u2", 20, "user", "new")])))
        #expect(!log.rows.contains(.handoff(id: "handoff")))
    }
}

struct InlineApprovalTests {
    let prompt = Prompt(id: "p1", text: "Bash: git push origin 88-login-flake", choices: [
        PromptChoice(id: "1", label: "Yes"),
        PromptChoice(id: "2", label: "Yes, and don't ask again for git push commands"),
        PromptChoice(id: "3", label: "No, and tell Claude what to do differently"),
    ])

    @Test func aPermissionDialogGivesDenyAlwaysAndAllow() {
        let card = InlineApproval(prompt: prompt, agent: "Bolt")
        #expect(card.title == "Bolt wants to run a command")
        #expect(card.command == "Bash: git push origin 88-login-flake")
        #expect(card.deny == "3")
        #expect(card.always == "2")
        #expect(card.allow == "1")
    }

    @Test func aDialogWithoutAlwaysOrNoGivesOnlyThoseItHas() {
        let card = InlineApproval(prompt: Prompt(id: "p", text: "Edit main.go", choices: [PromptChoice(id: "1", label: "Yes")]), agent: "")
        #expect(card.title == "The agent wants to run a command")
        #expect(card.allow == "1")
        #expect(card.always == nil)
        #expect(card.deny == nil)
    }
}

@MainActor
struct ChatModelTests {
    let approvals = #"[{"ID":"a1","SessionID":"s1","Mate":"bolt","Requester":"U1","Channel":"","ThreadTS":"","Message":"","Action":{"Kind":"git_push","Tool":"Bash","Input":"git push"},"At":"2026-10-18T14:02:00Z","State":"pending"},{"ID":"a2","SessionID":"s2","Mate":"ada","Requester":"U1","Channel":"","ThreadTS":"","Message":"","Action":{"Kind":"merge","Tool":"Bash","Input":"gh pr merge"},"At":"2026-10-18T14:02:00Z","State":"pending"}]"#
    let decided = #"{"ID":"a1","SessionID":"s1","Mate":"bolt","Requester":"U1","Action":{"Kind":"git_push","Tool":"Bash","Input":"git push"},"At":"2026-10-18T14:02:00Z","State":"approved"}"#

    func make() -> (ChatModel, FakeCaller) {
        let caller = FakeCaller()
        caller.replies["transcript.page"] = .success(chatPage([chatMessage("u1", 10, "user", "hi")], before: 10))
        caller.replies["approval.list"] = .success(approvals)
        caller.replies["session.send"] = .success(#"{"id":"q1","queued":true}"#)
        caller.replies["approval.decide"] = .success(decided)
        return (ChatModel(session: "s1", caller: caller), caller)
    }

    @Test func refreshReadsTheNewestPageAndTheApprovalsOfThisSession() async throws {
        let (chat, caller) = make()
        await chat.refresh(freshFrom: nil)
        #expect(caller.methods() == ["transcript.page", "approval.list"])
        let params = try #require(caller.calls.first?.params)
        #expect(params["session"] as? String == "s1")
        #expect(params["before"] == nil)
        #expect(chat.log.rows == [.owner(id: "u1", text: "hi")])
        #expect(chat.approvals.map(\.id) == ["a1"])
    }

    @Test func aStartFreshReadsTheOldSessionOnceAboveTheDivider() async throws {
        let (chat, caller) = make()
        await chat.refresh(freshFrom: "s0")
        #expect(caller.methods() == ["transcript.page", "transcript.page", "approval.list"])
        #expect(caller.calls[0].params["session"] as? String == "s0")
        #expect(caller.calls[1].params["session"] as? String == "s1")
        #expect(chat.log.rows.contains(.handoff(id: "handoff")))
        await chat.refresh(freshFrom: "s0")
        #expect(caller.calls.filter { $0.params["session"] as? String == "s0" }.count == 1)
    }

    @Test func olderAsksForThePageBeforeTheOldestMessage() async throws {
        let (chat, caller) = make()
        await chat.refresh(freshFrom: nil)
        caller.replies["transcript.page"] = .success(chatPage([chatMessage("a0", 5, "assistant", "earlier")]))
        await chat.loadOlder()
        #expect(try #require(caller.calls.last?.params)["before"] as? Int == 10)
        #expect(chat.log.rows.first == .agent(id: "a0", text: "earlier"))
        let count = caller.calls.count
        await chat.loadOlder()
        #expect(caller.calls.count == count)
    }

    @Test func sendQueuesTheDraftAndClearsIt() async throws {
        let (chat, caller) = make()
        chat.draft = "  Watch CI  "
        await chat.send()
        let params = try #require(caller.calls.last?.params)
        #expect(caller.methods() == ["session.send"])
        #expect(params["session"] as? String == "s1")
        #expect(params["text"] as? String == "Watch CI")
        #expect(chat.draft == "")
    }

    @Test func aBlankDraftSendsNothing() async {
        let (chat, caller) = make()
        chat.draft = "   "
        await chat.send()
        #expect(caller.calls.isEmpty)
    }

    @Test func aFailedSendKeepsTheDraftAndShowsTheError() async {
        let (chat, caller) = make()
        caller.replies["session.send"] = .failure(RPCError(code: "not_found", message: "no such session"))
        chat.draft = "hi"
        await chat.send()
        #expect(chat.draft == "hi")
        #expect(chat.error == "no such session")
    }

    @Test func decidingAnApprovalCallsDecideAndRemovesIt() async throws {
        let (chat, caller) = make()
        await chat.refresh(freshFrom: nil)
        await chat.decide("a1", approve: true)
        let params = try #require(caller.calls.last?.params)
        #expect(caller.calls.last?.method == "approval.decide")
        #expect(params["id"] as? String == "a1")
        #expect(params["approve"] as? Bool == true)
        #expect(chat.approvals.isEmpty)
    }

    @Test func aServerWithoutApprovalsStillShowsTheChat() async {
        let (chat, caller) = make()
        caller.replies["approval.list"] = .failure(RPCError(code: "unknown_method", message: "unknown"))
        await chat.refresh(freshFrom: nil)
        #expect(chat.log.rows.count == 1)
        #expect(chat.error == nil)
    }
}
