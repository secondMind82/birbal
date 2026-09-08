// ==============================================
// GOOGLE SIGN-IN CONFIG
// ==============================================
//
// Replace the placeholder values below with your real
// Google Cloud / Firebase OAuth client IDs.
//
// Where to find them (Google Cloud Console > Credentials,
// or Firebase Console > Project settings):
//   - webClientId:    Web client ID (also used on Android)
//   - iosClientId:    iOS app client ID
//
// Also update in app.json:
//   - plugins[].iosUrlScheme -> the iOS "reversed client ID"
//     (com.googleusercontent.apps.YOUR_IOS_CLIENT_ID_SUFFIX)
//
// And set GOOGLE_WEB_CLIENT_ID on the backend .env / Render.

export const socialAuthConfig = {
  // Web client ID (MUST be the "Web application" type OAuth client).
  // Android client ID yaha use mat karo - woh requestIdToken audience fail karta hai.
  webClientId:
    '815752089625-jbiim0gkne40lru12cdrnkn1cfgc7m3d.apps.googleusercontent.com',
  iosClientId: 'YOUR_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com',
};