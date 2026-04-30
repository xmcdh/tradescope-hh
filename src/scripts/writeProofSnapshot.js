import { writeDailyProofSnapshot } from '../lib/paperProofReport.js';

writeDailyProofSnapshot()
  .then((report) => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          generatedAt: report.generatedAt,
          verdict: report.finalVerdict,
          storage: report.storage?.code,
          officialPaperTrackingStartDate: report.officialPaperTrackingStartDate,
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
