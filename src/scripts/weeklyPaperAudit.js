import { writeWeeklyPaperAudit } from '../lib/paperAudit.js';

writeWeeklyPaperAudit()
  .then(({ report, jsonPath, markdownPath }) => {
    console.log(
      JSON.stringify(
        {
          reportJson: jsonPath,
          reportMarkdown: markdownPath,
          verdict: report.globalVerdict,
          storage: report.storage.authority,
          anomalies: report.anomalies.length,
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
