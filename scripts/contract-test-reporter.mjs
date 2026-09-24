// Compact evidence reporter: never dumps the huge main.js into test output.
export default async function* report(source) {
  let passed=0,failed=0;
  for await(const event of source) {
    if(event.type==='test:pass')passed++;
    if(event.type==='test:fail'){
      failed++;
      const e=event.data;
      yield `FAIL ${e.name} (${e.file??''}:${e.line??''})\n`;
    }
    if(event.type==='test:diagnostic' && /^(tests |pass |fail |duration_ms )/.test(event.data.message))yield `${event.data.message}\n`;
  }
  yield `REPORTED passed=${passed} failed=${failed}\n`;
}
