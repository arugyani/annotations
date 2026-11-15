import { writeFileSync } from "node:fs";
import { newComment, serialize } from "../src/model";
const doc = `A few notes on making room for the things that matter.

## Start small

Leave the phone in another room. Make coffee, open the notebook, and write a few lines before the day gets noisy.

The aim is not a perfect routine. It is a little more attention, given to one thing at a time.

## Keep what works

A short walk is often enough to change the shape of a day. Take the familiar route, notice something new, and come home with a clearer head.

Keep the plan simple enough to repeat. Leave room to change your mind.

## For next week

- Put a notebook beside the kettle.
- Take a walk before the first meeting.
- Make time for one unhurried conversation.
`;
const make = (
  quote: string,
  body: string,
  color: "yellow" | "blue" | "green",
) =>
  newComment(
    doc,
    doc.indexOf(quote),
    doc.indexOf(quote) + quote.length,
    "selection",
    body,
    "Me",
    color,
  );
const raw = serialize(doc, [
  make("write a few lines", "Three lines is plenty. Start there.", "yellow"),
  make("one thing at a time", "Keep this as the guiding idea.", "blue"),
  make(
    "A short walk is often enough",
    "Try this before the first meeting.",
    "green",
  ),
]);
writeFileSync("sample-vault/A slower morning.md", raw);
if (process.argv[2])
  writeFileSync(`${process.argv[2]}/A slower morning.md`, raw);
