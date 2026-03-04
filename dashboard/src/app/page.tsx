// Root page: redirects to /streams as the default landing page.
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/streams");
}
