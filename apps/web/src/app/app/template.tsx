export default function AppTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="app-page-enter">{children}</div>;
}
