// Google sign-in returns to lastword://auth. The sign-in screen already has the result by
// then; if Android also hands the link to the router, just go back into the app.
import { Redirect } from 'expo-router';

export default function AuthReturn() {
  return <Redirect href="/" />;
}
