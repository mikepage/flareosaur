/**
 * @title Parse and serialize CSV, also as streams
 * @difficulty intermediate
 * @tags workers, encoding, streams
 * @group Data formats
 * @resource {https://jsr.io/@std/csv} @std/csv
 * @resource {https://www.rfc-editor.org/rfc/rfc4180} RFC 4180: CSV
 * @check GET / -> 200 "Ada (36) and Grace (85)" "total age: 121" "streamed 3 rows" "Linus is 54" "name,age" "Ada,36" "streamed out: name,age|Ada,36|Grace,85|Linus,54"
 *
 * CSV is still how data moves between spreadsheets and systems. std's
 * `parse` reads a header row into records and `stringify` writes them
 * back. `CsvParseStream` and `CsvStringifyStream` do the same one row at a
 * time, for files too big for memory, whatever the chunk boundaries are.
 */

import {
  CsvParseStream,
  CsvStringifyStream,
  parse,
  stringify,
} from "@mikepage/flareosaur/csv";
import { script } from "./_lib/script.ts";

// A ReadableStream that yields the given values, standing in for a request
// body or an R2 object.
function streamOf<T>(values: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

const text = `name,age
Ada,36
Grace,85
`;

export default script(async (print) => {
  // skipFirstRow uses the header row as keys. Values are always strings.
  const people = parse(text, { skipFirstRow: true }).map((row) => ({
    name: row.name ?? "",
    age: Number(row.age),
  }));
  print(people.map((p) => `${p.name} (${p.age})`).join(" and "));
  print(`total age: ${people.reduce((sum, p) => sum + p.age, 0)}`);

  // Back to CSV text. columns picks the fields and their order.
  print(stringify(people, { columns: ["name", "age"] }));

  // Streaming in: chunks can split rows anywhere. In a Worker the source
  // would be request.body or an R2 object, through a TextDecoderStream.
  const chunks = streamOf(["name,age\nAd", "a,36\nGrace,8", "5\nLinus,54\n"]);
  const rows = await Array.fromAsync(
    chunks.pipeThrough(new CsvParseStream({ skipFirstRow: true })),
  );
  print(`streamed ${rows.length} rows`);
  print(`${rows[2]?.name} is ${rows[2]?.age}`);

  // Streaming out: records in, CSV lines out, ready for a Response body.
  const out = streamOf(rows).pipeThrough(
    new CsvStringifyStream({ columns: ["name", "age"] }),
  );
  const csv = await new Response(out.pipeThrough(new TextEncoderStream()))
    .text();
  print(`streamed out: ${csv.trim().split(/\r?\n/).join("|")}`);
});
