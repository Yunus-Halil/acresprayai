import { Reveal } from "./Reveal";
import { SOFTWARE, STATEMENT } from "./copy";

/**
 * The statement and the software, in one narrow column down the middle of a
 * pale band: a few lines of what the product is, then the parts of it as a
 * list of big names with a small line each. Little type, wide margins, thin
 * rules. The column is narrow on purpose; a page that says less can afford
 * to set it small.
 */
export const Statement = () => (
  <section id="detection" className="bg-sw-paper pb-20 pt-16 sm:pb-28 sm:pt-24">
    <div className="mx-auto max-w-[560px] px-5">
      <Reveal>
        <p className="m-0 text-[17px] leading-[1.45] tracking-[-0.01em] text-sw-ink sm:text-[19px]">
          {STATEMENT.lead.map((part, i) =>
            part.hi ? <span key={i} className="text-sw-green">{part.text}</span> : <span key={i}>{part.text}</span>,
          )}
        </p>
        <p className="m-0 mt-4 text-[15px] leading-[1.5] text-sw-muted">{STATEMENT.findings}</p>
      </Reveal>

      <Reveal className="mt-14 sm:mt-16">
        <div id="software" className="border-b border-sw-rule pb-2 text-[13px] text-sw-ink">{STATEMENT.softwareHeading}</div>
        <ul className="m-0 list-none p-0">
          {SOFTWARE.map(item => (
            <li key={item.name} className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-sw-rule py-4 sm:grid-cols-[150px_1fr]">
              <p className="m-0 text-[11px] leading-[1.4] text-sw-muted">{item.body}</p>
              <div className="text-right text-[30px] font-medium leading-none tracking-[-0.03em] text-sw-ink sm:text-left sm:text-[38px]">
                {item.name}
              </div>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  </section>
);
