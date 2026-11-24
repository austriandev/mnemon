# Mnemon

Mnemon answers questions about meetings from their transcripts, and every answer
cites the moment in the transcript it came from.

## Language

**Meeting**:
One recorded session, known to Mnemon through its transcript: an ordered sequence
of turns.
_Avoid_: call, session, recording

**Recording**:
The audio of a meeting, before it is transcribed. Mnemon never stores it: a recording
becomes a transcript, and the transcript is what is added.
_Avoid_: file, track

**Utterance**:
What speech-to-text returns: a stretch of speech with a speaker label ("A", "B") and
a start time. Utterances become turns once a person names the labels; until then
nobody knows who spoke.
_Avoid_: turn (an utterance has no speaker's name yet)

**Turn**:
One speaker's uninterrupted contribution to a meeting, with the time it starts and
the lines of the transcript it came from.
_Avoid_: utterance, segment, line

**Chunk**:
A run of whole, consecutive turns from one meeting, sized for retrieval. Neighbouring
chunks may share turns.
_Avoid_: passage, window, segment

**Record**:
Something extracted from a meeting that people ask about: a decision, an action item
or a topic, each tied to the turns that support it.
_Avoid_: insight, entity, note

**Excerpt**:
The turns of one meeting shown to the model for one question: the turns its
retrieved chunks cover, in order, with gaps marked.
_Avoid_: context, snippet

**Answer**:
A response to a question, as sentences that each cite the turns they rest on; or a
statement that the meetings don't say. An answer whose citations don't check out is
not shown.
_Avoid_: response, reply

**Citation**:
A pointer from an answer or record back to the turns it rests on: who said it, when,
and where in the transcript.
_Avoid_: source, reference, link

**Access code**:
The code a person signs in with. Meetings added under it are private to it, and it has
its own daily spending limit.
_Avoid_: password, account, user
