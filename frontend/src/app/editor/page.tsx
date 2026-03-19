import { redirect } from "next/navigation";
import { randomUUID } from "crypto";

export default function EditorHome() {
  const id = randomUUID();
  redirect(`/editor/${id}`);
}
