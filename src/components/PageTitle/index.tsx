import './pageTitle.css';
interface PageTitleProps {
  title: string;
  /** Retained for existing callers; page headings intentionally have no icon. */
  icon?: string;
  spaced?: boolean;
}
export default function PageTitle({ title, spaced = true }: PageTitleProps) {
  return <h1 className={`pgt${spaced ? ' pgt--spaced' : ''}`}>{title}</h1>;
}
