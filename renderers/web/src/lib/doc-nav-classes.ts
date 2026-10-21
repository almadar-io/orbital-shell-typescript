/**
 * Row states shared by the doc navigation molecules (DocSidebar, DocTOC,
 * DocPagination). They render ghost Buttons, whose action hover is a solid
 * primary fill; a navigation row instead hovers to the muted surface and marks
 * the current item with the accent. Labels inherit the row color.
 */

/** Hover for a navigation row that is not the current item. */
export const DOC_NAV_ROW_HOVER = 'hover:bg-muted hover:text-foreground hover:border-transparent';

/** The current item: an accent tint and accent text that keep on hover. */
export const DOC_NAV_ROW_ACTIVE = 'bg-accent/10 text-accent font-semibold hover:bg-accent/15 hover:text-accent hover:border-transparent';

/** An inactive row's resting color. */
export const DOC_NAV_ROW_IDLE = 'text-muted-foreground';

/** A rule-marked row (DocTOC): no fill on hover, only the text and the rule move. */
export const DOC_NAV_RULE_HOVER = 'hover:bg-transparent hover:text-foreground';

/** A link card (DocPagination): keeps its own surface, the border takes the accent. */
export const DOC_NAV_CARD_HOVER = 'hover:bg-card hover:text-foreground hover:border-accent';
