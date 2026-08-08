import { Redirect, useLocalSearchParams } from "expo-router";

// Deep-link target for invite links: forwards the token to the "Shared with me" screen,
// which pre-fills the accept field so the user can confirm joining.
export default function CollabAccept() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <Redirect href={{ pathname: "/home-intel/collab/shared", params: token ? { token } : {} }} />;
}
