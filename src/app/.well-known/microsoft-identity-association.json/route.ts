export const dynamic = "force-dynamic";

// Publisher-domain verification belongs to the deployment's own Entra client.
export function GET() {
  const id = process.env.MICROSOFT_CLIENT_ID?.trim();
  if (
    !id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    return new Response(null, { status: 404 });
  return Response.json({ associatedApplications: [{ applicationId: id }] });
}
