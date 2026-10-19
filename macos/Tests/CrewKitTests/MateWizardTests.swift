import Foundation
import Testing
@testable import CrewKit

struct MateWizardTests {
    static let options = [
        HarnessOptions.test(harness: "claude", name: "Claude Code", models: ["opus", "sonnet", "haiku"], efforts: ["low", "medium", "high", "max"], model: "opus", effort: "high"),
        HarnessOptions.test(harness: "codex", name: "Codex", models: ["gpt-5"], efforts: ["low", "medium", "high"], model: "gpt-5", effort: "medium"),
    ]

    @Test func theFourStepsInOrder() {
        #expect(MateStep.allCases.map(\.title) == ["Face", "Personality", "Brains", "Meet"])
        #expect(MateStep.brains.label == "Step 3 of 4")
    }

    @Test func aFaceGivesItsNameUntilTheUserTypesOne() {
        var w = MateWizard(options: Self.options)
        w.choose(face: "iris")
        #expect(w.draft.avatar == "iris")
        #expect(w.displayName == "Iris")
        #expect(w.draft.name == "iris")
        w.choose(face: "owl")
        #expect(w.displayName == "Owl")
        w.displayName = "Reviewer Bot"
        w.choose(face: "sage")
        #expect(w.displayName == "Reviewer Bot")
        #expect(w.draft.name == "reviewer-bot")
        #expect(w.draft.avatar == "sage")
    }

    @Test func theColorIsTheAccentOfTheFaceUntilTheUserPicksOne() {
        var w = MateWizard(options: Self.options)
        w.choose(face: "iris")
        #expect(w.color == FaceAccent.mauve.light)
        w.choose(color: .teal)
        w.choose(face: "owl")
        #expect(w.color == FaceAccent.teal.light)
        #expect(w.draft.color == FaceAccent.teal.light)
    }

    @Test func suggestGivesAFaceNameThatNoMateHas() {
        var w = MateWizard(options: Self.options, taken: ["pip", "bolt"])
        w.suggest()
        #expect(w.displayName == "Sage")
        #expect(w.draft.avatar == "sage")
    }

    @Test func continueNeedsAGoodNewNameThenAPersonality() {
        var w = MateWizard(options: Self.options, taken: ["iris"])
        w.displayName = ""
        #expect(!w.canContinue)
        w.choose(face: "iris")
        #expect(!w.canContinue)
        #expect(w.problem == "A mate named iris exists.")
        w.displayName = "Iris 2"
        #expect(w.canContinue)
        w.next()
        #expect(w.step == .personality)
        #expect(!w.canContinue)
        w.apply(preset: 0)
        #expect(w.canContinue)
        w.next()
        w.next()
        #expect(w.step == .meet)
        w.next()
        #expect(w.step == .meet)
        w.back()
        #expect(w.step == .brains)
    }

    @Test func aPresetFillsThePromptAndSetsTheTone() {
        var w = MateWizard(options: Self.options)
        w.choose(face: "iris")
        w.apply(preset: 0)
        #expect(w.preset == 0)
        #expect(w.personality.hasPrefix("You are Iris, a careful code reviewer."))
        #expect(w.tones.chips == ["Terse 2/5", "Cautious 2/5"])
        w.apply(preset: 3)
        #expect(w.personality.isEmpty)
        #expect(w.tones == MateTones())
        #expect(MatePreset.all.map(\.title) == ["Careful reviewer", "Fast bug fixer", "Patient explainer", "Blank"])
    }

    @Test func theSavedMateHasThePersonalityTheToneAndTheMemorySwitch() {
        var w = MateWizard(options: Self.options)
        w.choose(face: "iris")
        w.personality = "You review.\n"
        w.tones[.terse] = 1
        #expect(w.draft.mate.prompt == "You review.")
        #expect(w.draft.mate.tone == MateToneValue(terse: 2))
        #expect(w.draft.mate.avatar == "iris")
        #expect(w.draft.mate.noMemory == nil)
        w.memory = false
        #expect(w.draft.mate.noMemory == true)
        #expect(w.memoryLine == "Off. Iris keeps no notes.")
    }

    @Test func brainsStartAtTheDefaultsOfTheAgentAndResetOnASwitch() {
        var w = MateWizard(options: Self.options)
        #expect(w.draft.agent == "claude")
        #expect(w.draft.model == "opus")
        #expect(w.draft.effort == "high")
        #expect(w.models == ["opus", "sonnet", "haiku"])
        w.choose(agent: "codex")
        #expect(w.draft.model == "gpt-5")
        #expect(w.draft.effort == "medium")
        #expect(w.efforts == ["low", "medium", "high"])
        #expect(MateWizard.effortHint("high") == "Thinks more before it answers. Uses more of your limits.")
    }

    @Test func reposToggleAsChips() {
        var w = MateWizard(options: Self.options)
        w.toggle(repo: "api")
        w.toggle(repo: "web")
        w.toggle(repo: "api")
        #expect(w.repos == ["web"])
        #expect(w.draft.repos == "web")
    }

    @Test func theRepoChoicesAreTheSingleRepoWorkspaces() throws {
        let json = #"""
        [{"Root":"/w/api","Kind":"single","Repos":[{"Name":"api"}],"LastUsed":""},
         {"Root":"/w/org","Kind":"orchestration","Repos":[{"Name":"a"},{"Name":"b"}],"LastUsed":""},
         {"Root":"/w/web","Kind":"single","Repos":null,"LastUsed":""}]
        """#
        let workspaces = try JSONDecoder().decode([Workspace].self, from: Data(json.utf8))
        #expect(MateWizard.repoChoices(workspaces) == ["api", "web"])
    }

    @Test func meetSumsUpTheMate() {
        var w = MateWizard(options: Self.options)
        w.choose(face: "iris")
        w.toggle(repo: "api")
        w.toggle(repo: "web")
        #expect(w.brainsLine == "Claude Code · opus · high effort")
        #expect(w.reposLine == "api, web")
        #expect(w.memoryLine == "Empty. Iris writes notes here as it learns.")
        w.toggle(repo: "api")
        w.toggle(repo: "web")
        #expect(w.reposLine == "The first repo of each conversation")
    }

    @Test func editingAMateFillsTheWizard() {
        var def = MateDefinition(name: "iris", prompt: "You review.")
        def.tone = MateToneValue(cautious: 1)
        def.noMemory = true
        def.avatar = "owl"
        def.color = "#123456"
        def.repos = ["api"]
        let w = MateWizard(editing: def, options: Self.options)
        #expect(w.displayName == "Iris")
        #expect(w.personality == "You review.")
        #expect(w.tones[.cautious] == 0)
        #expect(w.memory == false)
        #expect(w.color == "#123456")
        #expect(w.repos == ["api"])
        #expect(w.canContinue)
    }
}

extension HarnessOptions {
    static func test(harness: String, name: String, models: [String], efforts: [String], model: String, effort: String) -> HarnessOptions {
        let object: [String: Any] = [
            "harness": harness, "name": name, "tag": "", "models": models, "efforts": efforts, "model": model, "effort": effort,
        ]
        return try! JSONDecoder().decode(HarnessOptions.self, from: JSONSerialization.data(withJSONObject: object))
    }
}
