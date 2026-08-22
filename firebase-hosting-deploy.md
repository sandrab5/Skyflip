# Firebase Hosting deployment checklist

This file is intentionally a checklist rather than an automated credential-bearing workflow.

1. Create/select the Firebase project on Spark.
2. Do not add billing or upgrade to Blaze.
3. Run `firebase login`.
4. Run `firebase use YOUR_FIREBASE_PROJECT_ID`.
5. Run `firebase deploy --only hosting`.
6. Confirm the generated `web.app` URL loads Skyflip.
7. Do not switch DNS or retire Render until the API cutover has been tested.
