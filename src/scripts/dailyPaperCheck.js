import { buildDailyPaperCheck } from '../lib/paperAudit.js';

buildDailyPaperCheck()
  .then(({ output }) => {
    console.log(output);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
