/**
 * Sessions — list, rename, and tag an agent's conversations.
 *
 * Share one `FileSystemConversationStorage` between the agent (which writes runs to it) and a
 * `SessionManager` (which reads/manages them). `listSessions()` returns a `SessionCapabilityResult`
 * — narrow on `.supported` before reading `.value`, so an incapable adapter degrades cleanly.
 */
import { Agent, Session, FileSystemConversationStorage } from "@theokit/sdk";

const storage = new FileSystemConversationStorage({ root: "./.sessions" });

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-oss-120b:free" },
  conversationStorage: storage,
  systemPrompt: "You are concise.",
});

await (await agent.send("What is 2+2? Answer with one word.")).wait();

const sessions = Session.create(storage);

const list = await sessions.listSessions();
if (!list.supported) {
  console.log("Sessions: (listing unsupported by this adapter)");
} else {
  console.log("Sessions:", list.value.length);

  const id = list.value[0]?.id;
  if (id) {
    await sessions.renameSession(id, "Math chat");
    await sessions.tagSession(id, "demo");
  }

  const after = await sessions.listSessions();
  if (after.supported) {
    const s = after.value[0];
    console.log("First session:", { messages: s?.messageCount, title: s?.title, tag: s?.tag });
  }
}

await agent.dispose();
