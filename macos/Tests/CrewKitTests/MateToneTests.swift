import Foundation
import Testing
@testable import CrewKit

struct MateToneTests {
    @Test func eachAxisHasFiveStepsAndTheMiddleAddsNoText() {
        for axis in ToneAxis.allCases {
            #expect(axis.sentences.count == 5)
            #expect(axis.sentences[2] == nil)
            #expect(axis.sentences.compactMap { $0 }.count == 4)
        }
        #expect(ToneAxis.allCases.map(\.rawValue) == ["terse", "cautious", "formal"])
        #expect(ToneAxis.terse.left == "Terse")
        #expect(ToneAxis.terse.right == "Chatty")
        #expect(ToneAxis.cautious.sentences[1] == "Ask before you run a command that changes files or pushes.")
        #expect(ToneAxis.terse.sentences[1] == "Keep answers short. Use lists, not paragraphs.")
    }

    @Test func eachStepAwayFromTheMiddleAddsOneVisibleSentence() {
        var tones = MateTones()
        #expect(tones.added.isEmpty)
        tones[.terse] = 1
        tones[.cautious] = 1
        #expect(tones.added == [
            ToneLine(axis: .terse, step: 1, label: "Terse 2/5", sentence: ToneAxis.terse.sentences[1]),
            ToneLine(axis: .cautious, step: 1, label: "Cautious 2/5", sentence: ToneAxis.cautious.sentences[1]),
        ])
        #expect(tones.lines.count == 3)
        #expect(tones.lines[2] == ToneLine(axis: .formal, step: 2, label: "Formal 3/5", sentence: nil))
        #expect(tones.chips == ["Terse 2/5", "Cautious 2/5"])
        tones[.formal] = 4
        #expect(tones.chips.last == "Playful 5/5")
    }

    @Test func aStepStaysInsideTheFiveSteps() {
        var tones = MateTones()
        tones[.terse] = 9
        #expect(tones[.terse] == 4)
        tones[.terse] = -3
        #expect(tones[.terse] == 0)
    }

    @Test func theToneGoesToTheDaemonAsOneToFiveAndTheMiddleIsLeftOut() throws {
        var tones = MateTones()
        #expect(tones.value == nil)
        tones[.terse] = 1
        tones[.formal] = 4
        #expect(tones.value == MateToneValue(terse: 2, cautious: nil, formal: 5))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(tones.value)) as? [String: Int]
        #expect(json == ["terse": 2, "formal": 5])
    }

    @Test func theToneOfTheDaemonGivesTheSteps() throws {
        let value = try JSONDecoder().decode(MateToneValue.self, from: Data(#"{"cautious":1,"formal":3}"#.utf8))
        let tones = MateTones(value)
        #expect(tones[.terse] == 2)
        #expect(tones[.cautious] == 0)
        #expect(tones[.formal] == 2)
        #expect(MateTones(nil) == MateTones())
    }

    @Test func theAxesOfTheDaemonReplaceTheBuiltInSentences() throws {
        let json = #"[{"key":"terse","low":"Terse","high":"Chatty","steps":["a","b","","d","e"]}]"#
        let axes = try JSONDecoder().decode([ToneAxisInfo].self, from: Data(json.utf8))
        var tones = MateTones(axes: axes)
        tones[.terse] = 1
        tones[.cautious] = 0
        #expect(tones.added.map(\.sentence) == ["b", ToneAxis.cautious.sentences[0]])
    }
}
