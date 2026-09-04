/**
 * DCSM MLC Slides — declarative render engine
 * Washington DC South Mission · Office Elders
 *
 * Format lives here as constants. The weekly and 4-week numbers come from
 * the WDCSM Reporting portal (GET /api/slides/weekly and /monthly); the
 * baptismal-date rosters come straight from the Baptisms (MLC) sheet.
 * Slides are drawn from scratch every run. No slide is ever read as a
 * style source, and no geometry is inferred from existing shapes.
 *
 * Zones, their order, and any excluded zone come from the portal
 * (Admin → Reporting settings), so a transfer needs no change here. A
 * zone with no roster tab in Baptisms (MLC) still appears on the mission
 * slide; only its zone slide is skipped, and the log says so.
 *
 * SETUP (once): Project Settings → Script Properties
 *     PORTAL_URL      https://dcsm-ki-portal.dcsm-reporting.workers.dev
 *     SLIDES_SECRET   the value set with `wrangler secret put SLIDES_READ_SECRET`
 *
 * buildSpecs_() produces the complete slide list, in the order they will
 * be drawn: zones first, then MLC share, then the mission overview. Both
 * the drawer and dryRun() consume it, so a preview always matches what
 * gets drawn. The one slide buildSpecs_() does NOT produce — the manually
 * maintained Social Media slide — is pinned to the very end of the deck
 * separately, after drawing, by pinSocialMediaSlideToEnd_().
 *
 * DIAGNOSTICS (write nothing):
 *   dumpPortal()       the numbers the portal returned, both modes
 *   dumpRosters()      baptismal-date rosters, per zone
 *   dryRun()           previews every slide, cell by cell
 *
 * RENDERERS:
 *   refreshWeekly()    current week — zones + MLC share + mission overview
 *   refreshMonthly()   4-week totals — zones + MLC share + mission overview
 *   refreshAll()       both
 *
 * !! DECK below points at the LIVE decks. Swap in test copies before
 *    experimenting.
 */

/*** DATA SOURCES ***/

var SRC = {
  /**
   * Leave blank to build the latest week imported into the portal. Set a
   * Monday ("2026-08-24") to rebuild a past week's deck, then blank it again.
   */
  WEEK: '',

  /**
   * Baptisms (MLC). One tab per zone, named "[Zone] Formatting"
   * ("[Zone] Formatted" is accepted too, so a rename cannot blank a deck).
   *
   *   B2 zone name   D2 goal string ("4/8" = completed of goal)
   *   row 3 headers  row 4+ people, columns B through H
   */
  SS_BAPTISMS: '1tMQgyrOEFxOy7LzmNJk-JNpd5KVKPbdoUoKTVTE4eKg',
  ROSTER_TAB_RE: /^(.+?)\s+Formatt(?:ing|ed)$/i,
  ROSTER_LAST_ROW: 200,

  /** Never initialize these when shortening a name to fit its column. */
  NAME_PARTICLES: /^(de|del|la|las|los|y|da|das|do|dos|van|von|di|el|al|bin)$/i,

  /**
   * Key indicators in slide order. The portal sends exactly these codes
   * (its KI_DECK_LABEL table); fetchPortal_() refuses a response that lacks one.
   *   BC  Baptized and Confirmed
   *   BD  Baptismal Date
   *   SAC Sacrament Attendance
   *   NP  New People Found
   *   LWM Lessons with Member Participation
   *   RCA Recent Convert Attendance
   */
  KIS: ['BC', 'BD', 'SAC', 'NP', 'LWM', 'RCA']
};

/*** FORMAT — the single source of design truth ***/

var FMT = {
  SLIDE_W: 720,
  SLIDE_H: 405,

  FONT: 'Lato',

  MARGIN_L: 30,
  RIGHT_EDGE: 681,

  // Title and subtitle share one text box; the subtitle trails the title
  // on the same baseline. TITLE_GAP is spaces, not points — Slides has no
  // intra-paragraph horizontal offset.
  TITLE_TOP: 16,
  TITLE_H: 30,
  TITLE_SIZE: 22,
  TITLE_COLOR: '#1F3864',
  TITLE_GAP: '   ',

  SUBTITLE_SIZE: 12,
  SUBTITLE_COLOR: '#6B7280',

  // Header band sits higher now that the subtitle no longer occupies
  // its own row and the top-right note is gone.
  HEADER_TOP: 56,
  HEADER_H: 20,
  HEADER_SIZE: 13,
  HEADER_COLOR: '#1F3864',

  RULE_Y: 78,
  RULE_COLOR: '#B8BFC7',

  BODY_TOP: 84,
  BODY_BOTTOM: 356,

  LEGEND_Y: 366,
  LEGEND_CHIP: 9,
  LEGEND_SIZE: 8.5,
  LEGEND_COLOR: '#374151',

  GAP_X: 4,
  GAP_Y: 4,

  LABEL_COLOR: '#1A1A1A',
  OF_COLOR: '#9AA1AA',

  // --- MLC share slide ---
  MLC_LABEL_W: 100,
  MLC_SECTION_SIZE: 8.5,
  MLC_SECTION_COLOR: '#6B7280',
  MLC_BLOCK1_LABEL: 104,
  MLC_BLOCK2_LABEL: 232,
  MLC_SECTION_GAP: 20,   // section label top -> first row top
  MLC_ROW_H: 24,
  MLC_ROW_GAP: 4,
  MLC_PLAIN_FILL: '#F1F3F5',
  MLC_PLAIN_TEXT: '#1A1A1A',
  MLC_PLAIN_SIZE: 13,
  MLC_SHARE_SIZE: 15,
  MLC_LEGEND_Y: 352,

  /**
   * Slides text boxes carry a fixed internal inset that the API cannot
   * set to zero. insetBox_() compensates by growing the box, so the text
   * itself lands exactly on the coordinates asked for.
   *
   * 7.2pt = 0.1 inch, measured off a rendered slide: a body box inserted
   * at x 26.4 / y 95.4 put its glyphs at x 33.6 / y 102.45. This was 3.6
   * for several revisions — exactly half — which left every roster stripe
   * sitting 3.45pt above its row and survived three attempts to fix it by
   * adjusting line spacing, because the pitch was never the problem.
   */
  TEXT_INSET: 7.2,

  /** Safety margin when clipping cell text to its column, in points. */
  CLIP_PAD: 2,

  // --- Zone weekly slide ---
  // KI tiles live in the top-right corner beside the title, so the roster
  // owns everything below the header rule.
  // Far enough right to clear the longest zone name ("Bella Vista West")
  // plus its week label at title size.
  Z_KI_LEFT: 335,
  Z_KI_GAP: 3,
  Z_KI_LABEL_TOP: 12,
  Z_KI_LABEL_H: 10,
  Z_KI_LABEL_SIZE: 8,
  Z_KI_TILE_TOP: 24,
  Z_KI_TILE_H: 32,
  Z_KI_PCT_SIZE: 13,
  Z_KI_OF_SIZE: 6,

  Z_HEAD_RULE_Y: 60,

  // The goal chip is taller than the label beside it, so the label row
  // is placed to clear the column headers by the chip's height, not the
  // label's — otherwise the chip laps over the headers.
  Z_ROSTER_LABEL_TOP: 64,
  Z_ROSTER_LABEL_H: 13,
  Z_ROSTER_LABEL_SIZE: 8.5,
  Z_GOAL_CHIP_W: 64,
  Z_GOAL_CHIP_H: 18,
  Z_GOAL_CHIP_RISE: 3,     // chip top above the label row
  Z_GOAL_LABEL_GAP: 10,
  Z_GOAL_LABEL_W: 130,

  Z_ROSTER_HEAD_TOP: 83,
  Z_ROSTER_HEAD_H: 11,
  Z_ROSTER_HEAD_SIZE: 8.5,
  Z_ROSTER_HEAD_COLOR: '#1F3864',
  Z_ROSTER_RULE_Y: 95,
  Z_ROSTER_TOP: 99,
  Z_ROSTER_BOTTOM: 397,

  /**
   * Static roster type. Every zone renders identically, so nine slides
   * read as one table rather than nine differently-scaled ones, and no
   * run can produce a size nobody has checked.
   *
   * These slides are read off phones on a shared Zoom screen, so the
   * type is sized for that rather than for fitting the longest list.
   * Zones past Z_ROSTER_BOTTOM spill off the slide; the sheet orders
   * soonest dates first, so what falls off is the furthest out.
   */
  Z_ROW_FONT: 10,

  /**
   * Row pitch is font x Z_LINE_NORMAL, and line spacing is deliberately
   * NEVER set.
   *
   * This factor is measured, not assumed: a 7.5pt roster rendered rows
   * at 9.01pt against 9.00 computed, exact to the limit of measurement.
   * Setting an explicit spacing percentage broke that — Slides does not
   * scale the pitch by the percentage the way the constant implies, so
   * stripes drawn on the computed grid accumulated roughly 0.36pt of
   * error per row and visibly separated from the text by the bottom of
   * a long roster.
   *
   * The text columns never drift relative to each other; only shapes on
   * an assumed grid do. Keeping the grid to the one factor that has been
   * verified is what keeps the stripes locked to the rows.
   */
  Z_LINE_NORMAL: 1.2,      // Slides single-spacing = 1.2 × font size
  Z_CHAR_W: 0.52,          // Lato average glyph width as a fraction of em

  /** Manual point trim if stripes still sit high or low. */
  Z_STRIPE_NUDGE: 0,

  Z_TEXT_COLOR: '#1A1A1A',
  // Deep enough to survive Zoom compression on a phone screen, light
  // enough not to fight the red/green glyphs.
  Z_STRIPE_FILL: '#EDF1F6',
  Z_YES: '✓',
  Z_NO: '✗',
  Z_YES_COLOR: '#1E7B45',
  Z_NO_COLOR: '#C0392B',
  Z_SOON_COLOR: '#1E7B45',
  Z_GOAL_FILL: '#1F3864',
  Z_GOAL_SIZE: 11,

  /**
   * Widths sum to RIGHT_EDGE - MARGIN_L. Missionaries gets the most
   * room because it is the only field that routinely runs long; every
   * cell is clipped to its column so a wrap can never push one column
   * out of step with the others.
   */
  ROSTER_COLS: [
    { key: 'name',         head: 'Name',         w: 155, align: 'START'  },
    { key: 'date',         head: 'Date',         w: 42,  align: 'CENTER' },
    { key: 'church',       head: 'Church 2x',    w: 52,  align: 'CENTER', glyph: true },
    { key: 'calendar',     head: 'Calendar',     w: 52,  align: 'CENTER', glyph: true },
    { key: 'ward',         head: 'Ward',         w: 91,  align: 'START'  },
    { key: 'missionaries', head: 'Missionaries', w: 205, align: 'START'  },
    { key: 'done',         head: 'Baptized',     w: 54,  align: 'CENTER', glyph: true }
  ],

  PALETTE: {
    under:  { tint: '#F9E8E6', text: '#C0392B', solid: '#C0392B' },
    middle: { tint: '#FCF2DF', text: '#C4881A', solid: '#C4881A' },
    upper:  { tint: '#E6F2EA', text: '#27804A', solid: '#1E7B45' },
    none:   { tint: '#F1F3F5', text: '#8A9099', solid: '#8A9099' }
  },
  WHITE: '#FFFFFF',

  BANDS_GOAL:  { mid: 0.50, high: 0.80 },
  BANDS_SHARE: { mid: 0.20, high: 0.30 },

  LEGEND_GOAL: [
    { band: 'under',  label: 'Under 50%' },
    { band: 'middle', label: '50–79%' },
    { band: 'upper',  label: '80%+' }
  ],
  LEGEND_SHARE: [
    { band: 'under',  label: 'Under 20% share' },
    { band: 'middle', label: '20–29%' },
    { band: 'upper',  label: '30% or above' }
  ],

  MARK: '[AUTOGEN]',

  /**
   * Identifies the manually-maintained Social Media slide by its speaker
   * notes. Deliberately a different marker than MARK so clearGenerated_()
   * never removes it — that slide is edited by hand, not drawn by this
   * script. See pinSocialMediaSlideToEnd_().
   */
  SOCIAL_MARK: '[Social Media]'
};

var DECK = {
  WEEKLY:  '1Y0Ux_PdSTgPpGsxZv7ptXLGEhKiP851rstLQhoftu5M',
  MONTHLY: '1hY-qMVq4Ibj-DJqcwCPXQBHqzChQ142akaHEan19tZE'
};

/*** ENTRY POINTS ***/

function refreshWeekly()  { return build_('weekly'); }
function refreshMonthly() { return build_('monthly'); }

function refreshAll() {
  return build_('weekly') + '\n\n' + build_('monthly');
}

function build_(mode) {
  var log = [];
  var plan = buildSpecs_(mode);
  plan.notes.forEach(function (n) { log.push(n); });

  var deck = SlidesApp.openById(mode === 'weekly' ? DECK.WEEKLY : DECK.MONTHLY);
  log.push('Deck: ' + deck.getName());

  var removed = clearGenerated_(deck);
  log.push('Removed ' + removed + ' previously generated slide(s).');

  plan.specs.forEach(function (spec, i) {
    if (spec.kind === 'mlc') drawMlcSlide_(deck, spec);
    else if (spec.kind === 'zone') drawZoneSlide_(deck, spec);
    else drawGridSlide_(deck, spec);
    log.push('  [' + (i + 1) + '] ' + spec.title);
  });
  log.push('Drew ' + plan.specs.length + ' slide(s).');

  // The autogenerated slides above are always appended to the end, which
  // would push a Social Media slide sitting elsewhere in the deck out of
  // last position. Re-pin it after every run rather than assuming its
  // spot survived.
  var pin = pinSocialMediaSlideToEnd_(deck);
  if (pin.found) {
    log.push('Moved the manually-maintained Social Media slide to the end' +
             (pin.count > 1
               ? ' (found ' + pin.count + ' slides matching "' + FMT.SOCIAL_MARK +
                 '" — only the first was moved; check for a duplicate).'
               : '.'));
  } else {
    log.push('No manually-maintained Social Media slide found (notes containing "' +
              FMT.SOCIAL_MARK + '"); nothing pinned.');
  }

  var text = log.join('\n');
  Logger.log(text);
  return text;
}

/*** SLIDE PLANNING ***/

function buildSpecs_(mode) {
  var data = mode === 'weekly' ? gatherWeekly_() : gatherMonthly_();
  var notes = data.notes;
  var specs = [];

  if (missionTotal_(data.mission) === 0) {
    throw new Error('All mission figures read as zero. Refusing to publish blank slides.');
  }

  // 1 — Zones first.
  if (mode === 'weekly') {
    // Zone weekly: that zone's KI row over its baptismal-date roster.
    data.zones.forEach(function (z) {
      if (!z.roster) {
        notes.push('Zone slide skipped, no roster tab: ' + z.name);
        return;
      }
      specs.push({
        kind: 'zone',
        title: z.name,
        subtitle: data.subtitle,
        colHeaders: SRC.KIS.slice(),
        kis: z.kis,
        roster: z.roster,
        bands: FMT.BANDS_GOAL
        // No colour key here — the mission slide later carries it,
        // and the space is worth more to the roster.
      });
    });
  } else {
    // Zone 4-week: KIs down the side, weeks across the top,
    // oldest on the left through newest on the right, then MONTH.
    data.zones.forEach(function (z) {
      if (!z.detail) return;
      var heads = z.detail.map(function (w) { return w.label; }).concat(['MONTH']);
      var zrows = SRC.KIS.map(function (ki) {
        var cells = z.detail.map(function (w) { return w.kis[ki]; });
        cells.push(z.kis[ki]);
        return { label: ki, cells: cells };
      });
      specs.push({
        kind: 'grid',
        title: z.name,
        subtitle: data.subtitle,
        colHeaders: heads,
        rows: zrows,
        labelW: 80,
        solidRows: [],
        solidCols: [heads.length - 1],
        bands: FMT.BANDS_GOAL,
        legend: FMT.LEGEND_GOAL
      });
    });
  }

  // 2 — MLC share. Always this-week / last-week, in both decks.
  //     goal = mission total, actual = MLC areas; the portal sends it that way.
  if (data.mlc && data.mlc.thisWeek) {
    if (!data.mlc.lastWeek) {
      notes.push('NOTE: the portal has no earlier week; the LAST WEEK block shows zeros.');
    }
    specs.push({
      kind: 'mlc',
      title: 'MLC Key Indicators',
      subtitle: data.subtitle,
      colHeaders: SRC.KIS.slice(),
      blocks: [
        { label: 'THIS WEEK', kis: data.mlc.thisWeek },
        { label: 'LAST WEEK', kis: data.mlc.lastWeek || zeroKis_() }
      ],
      bands: FMT.BANDS_SHARE,
      legend: FMT.LEGEND_SHARE
    });
  } else {
    notes.push('MLC slide skipped: the portal response had no MLC figures.');
  }

  // 3 — Mission overview last among the autogenerated slides: zones down
  //     the side, KIs across the top. This leads straight into the
  //     manually-maintained Social Media slide, which is pinned to the
  //     very end of the deck separately (see pinSocialMediaSlideToEnd_,
  //     called from build_() after all specs here are drawn).
  var rows = data.zones.map(function (z) {
    return { label: z.name, cells: SRC.KIS.map(function (ki) { return z.kis[ki]; }) };
  });
  rows.push({
    label: 'MISSION',
    cells: SRC.KIS.map(function (ki) { return data.mission[ki]; })
  });

  specs.push({
    kind: 'grid',
    title: mode === 'weekly' ? 'Mission This Week' : 'Mission at a Glance',
    subtitle: data.subtitle,
    colHeaders: SRC.KIS.slice(),
    rows: rows,
    labelW: 96,
    solidRows: [rows.length - 1],
    solidCols: [],
    bands: FMT.BANDS_GOAL,
    legend: FMT.LEGEND_GOAL
  });

  return { data: data, specs: specs, notes: notes };
}

/*** DRAWING — SHARED PARTS ***/

/**
 * Title and subtitle in one text box, subtitle trailing on the same
 * baseline. The old top-right note box is gone entirely.
 */
function drawChrome_(slide, spec) {
  var box = slide.insertTextBox('', FMT.MARGIN_L, FMT.TITLE_TOP,
                                FMT.RIGHT_EDGE - FMT.MARGIN_L, FMT.TITLE_H);
  box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);

  var title = spec.title || '';
  var sub = spec.subtitle || '';
  var full = sub ? title + FMT.TITLE_GAP + sub : title;

  var tr = box.getText();
  tr.setText(full);
  tr.getTextStyle()
    .setFontFamily(FMT.FONT).setFontSize(FMT.TITLE_SIZE).setBold(true)
    .setForegroundColor(FMT.TITLE_COLOR);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

  if (sub) {
    tr.getRange(title.length, full.length).getTextStyle()
      .setFontSize(FMT.SUBTITLE_SIZE).setBold(false)
      .setForegroundColor(FMT.SUBTITLE_COLOR);
  }
  try { box.getBorder().setTransparent(); } catch (e) {}
}

function drawHeaders_(slide, headers, gridLeft, cellW, top, h, ruleY) {
  top = top === undefined ? FMT.HEADER_TOP : top;
  h = h === undefined ? FMT.HEADER_H : h;
  ruleY = ruleY === undefined ? FMT.RULE_Y : ruleY;

  headers.forEach(function (label, c) {
    var x = gridLeft + c * (cellW + FMT.GAP_X);
    var box = slide.insertTextBox('', x, top, cellW, h);
    box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(box, String(label), FMT.HEADER_SIZE, FMT.HEADER_COLOR, true, 'CENTER');
  });

  drawRule_(slide, ruleY);
}

function drawRule_(slide, y, x1, x2) {
  var rule = slide.insertLine(SlidesApp.LineCategory.STRAIGHT,
                              x1 === undefined ? FMT.MARGIN_L : x1, y,
                              x2 === undefined ? FMT.RIGHT_EDGE : x2, y);
  rule.getLineFill().setSolidFill(FMT.RULE_COLOR);
  rule.setWeight(1);
  return rule;
}

function drawLegend_(slide, items, y) {
  var x = FMT.MARGIN_L;
  items.forEach(function (it) {
    var chip = slide.insertShape(SlidesApp.ShapeType.RECTANGLE,
                                 x, y, FMT.LEGEND_CHIP, FMT.LEGEND_CHIP);
    paintShape_(chip, FMT.PALETTE[it.band].solid);
    x += FMT.LEGEND_CHIP + 5;

    var box = slide.insertTextBox('', x, y - 3, 100, FMT.LEGEND_CHIP + 6);
    box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(box, it.label, FMT.LEGEND_SIZE, FMT.LEGEND_COLOR, false, 'START');
    x += 104;
  });
}

/*** DRAWING — GOAL GRID ***/

function drawGridSlide_(deck, spec) {
  var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);

  var nCols = spec.colHeaders.length;
  var nRows = spec.rows.length;

  var gridLeft = FMT.MARGIN_L + spec.labelW;
  var gridW = FMT.RIGHT_EDGE - gridLeft;
  var cellW = (gridW - FMT.GAP_X * (nCols - 1)) / nCols;

  var bodyH = FMT.BODY_BOTTOM - FMT.BODY_TOP;
  var cellH = (bodyH - FMT.GAP_Y * (nRows - 1)) / nRows;

  var pctSize = Math.min(15, Math.max(9, cellH * 0.50));
  var ofSize  = Math.min(7,  Math.max(5.5, cellH * 0.27));
  var lblSize = Math.min(14, Math.max(9, cellH * 0.42));

  drawChrome_(slide, spec);
  drawHeaders_(slide, spec.colHeaders, gridLeft, cellW);

  spec.rows.forEach(function (row, r) {
    var y = FMT.BODY_TOP + r * (cellH + FMT.GAP_Y);
    var rowSolid = spec.solidRows.indexOf(r) !== -1;

    var lbl = slide.insertTextBox('', FMT.MARGIN_L, y, spec.labelW - 8, cellH);
    lbl.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(lbl, row.label, lblSize, FMT.LABEL_COLOR, true, 'START');

    row.cells.forEach(function (cell, c) {
      var x = gridLeft + c * (cellW + FMT.GAP_X);
      var solid = rowSolid || spec.solidCols.indexOf(c) !== -1;
      drawTile_(slide, x, y, cellW, cellH, cell, solid, spec.bands, pctSize, ofSize);
    });
  });

  drawLegend_(slide, spec.legend, FMT.LEGEND_Y);
  markGenerated_(slide, spec.title);
  return slide;
}

function drawTile_(slide, x, y, w, h, cell, solid, bands, pctSize, ofSize) {
  var band = bandFor_(cell, bands);
  var pal = FMT.PALETTE[band];

  var shape = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, x, y, w, h);
  paintShape_(shape, solid ? pal.solid : pal.tint);
  shape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);

  // "1 of 0" reads as a data error, not a win — a goal of 0 with a
  // positive actual has nothing to divide, so swap in a plain note for
  // that one case. Every other case keeps the actual-of-goal fraction.
  var noGoalWin = !cell.goal && cell.actual > 0;
  var sub = noGoalWin ? 'no goal set' : cell.actual + ' of ' + cell.goal;

  var tr = shape.getText();
  tr.setText(pctText_(cell) + '\n' + sub);

  var paras = tr.getParagraphs();
  var top = paras[0].getRange();
  top.getTextStyle()
     .setFontFamily(FMT.FONT).setFontSize(pctSize).setBold(true)
     .setForegroundColor(solid ? FMT.WHITE : pal.text);
  top.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  if (paras.length > 1) {
    var bot = paras[1].getRange();
    bot.getTextStyle()
       .setFontFamily(FMT.FONT).setFontSize(ofSize).setBold(false)
       .setForegroundColor(solid ? FMT.WHITE : FMT.OF_COLOR);
    bot.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  }
}

/*** DRAWING — ZONE WEEKLY (KI strip + roster) ***/

/**
 * Static roster geometry. Row pitch and type size never vary, so the fit
 * is whatever was checked once, on every zone, every week.
 */
function rosterMetrics_(n) {
  var font = FMT.Z_ROW_FONT;

  // Single spacing, so the line box is the glyph block and the pitch is
  // the one factor that has been verified against a real render. With no
  // extra leading to distribute, font metrics centre the glyphs in the
  // box on their own and a stripe on the grid lands square on the row.
  var rowH = font * FMT.Z_LINE_NORMAL;
  var avail = FMT.Z_ROSTER_BOTTOM - FMT.Z_ROSTER_TOP;
  var visible = Math.floor(avail / rowH);
  var stripeY = FMT.Z_STRIPE_NUDGE;

  // Everyone is drawn. Names past `visible` run off the bottom of the
  // slide, which is acceptable because the sheet is ordered soonest
  // first — what disappears is always the furthest-out date.
  return {
    font: font, rowH: rowH, avail: avail, visible: visible,
    stripeY: stripeY, shown: n, hidden: Math.max(0, n - visible),
    height: n * rowH, overflow: n > visible
  };
}

/**
 * A text box whose *text* occupies exactly (x, y, w, h). Slides applies a
 * fixed internal inset that no API call can zero, so the box is grown by
 * that inset on every side and shifted back to compensate.
 */
function insetBox_(slide, x, y, w, h) {
  var i = FMT.TEXT_INSET;
  return slide.insertTextBox('', x - i, y - i, w + 2 * i, h + 2 * i);
}

/**
 * Characters a column can show. insetBox_ makes the content area exactly
 * the requested width, so this is the column width less a safety margin
 * — not less the inset, which has already been compensated for.
 */
function colChars_(w, font) {
  return Math.floor((w - FMT.CLIP_PAD) / (font * FMT.Z_CHAR_W));
}

/** Clip to what the column can actually show, so nothing ever wraps. */
function clip_(s, w, font) {
  s = String(s == null ? '' : s);
  var max = colChars_(w, font);
  if (max < 1) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s,&]+$/, '') + '…';
}

/**
 * Fit a person's name to its column without losing the surname.
 *
 * Plain truncation cuts from the right, which is exactly backwards for
 * the four-part names common in the Spanish-speaking zones — the part
 * that identifies someone is the end, not the beginning. So interior
 * given names are reduced to initials first, then the first name, and
 * only a name still too long after that gets clipped.
 *
 *   Flor Celeste Villagomez Ramirez -> Flor C. Villagomez Ramirez
 *   Johan Sebastian Villamil Rojas  -> Johan S. Villamil Rojas
 */
function fitName_(s, w, font) {
  s = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  var max = colChars_(w, font);
  if (!s || s.length <= max) return s;

  var parts = s.split(' ');
  for (var i = 1; i < parts.length - 1; i++) {
    if (parts.join(' ').length <= max) break;
    if (parts[i].length > 2 && !SRC.NAME_PARTICLES.test(parts[i])) {
      parts[i] = parts[i].charAt(0) + '.';
    }
  }
  if (parts.join(' ').length <= max) return parts.join(' ');

  if (parts.length > 1 && parts[0].length > 2) {
    parts[0] = parts[0].charAt(0) + '.';
    if (parts.join(' ').length <= max) return parts.join(' ');
  }
  return clip_(parts.join(' '), w, font);
}

/** "Elders Barber & Hoopes" -> "E. Barber & Hoopes". */
function shortMissionaries_(s) {
  return String(s == null ? '' : s)
    .replace(/^Elders\s+/i, 'E. ')
    .replace(/^Sisters\s+/i, 'S. ');
}

function rosterCellText_(p, col) {
  if (col.glyph) return p[col.key] ? FMT.Z_YES : FMT.Z_NO;
  if (col.key === 'date') return fmtDate_(p.date);
  if (col.key === 'name') return fitName_(p.name, col.w, FMT.Z_ROW_FONT);
  if (col.key === 'missionaries') {
    return clip_(shortMissionaries_(p.missionaries), col.w, FMT.Z_ROW_FONT);
  }
  return clip_(p[col.key], col.w, FMT.Z_ROW_FONT);
}

function drawZoneSlide_(deck, spec) {
  var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  drawChrome_(slide, spec);

  // --- KI tiles, top-right beside the title ---
  var nKis = spec.colHeaders.length;
  var kiW = (FMT.RIGHT_EDGE - FMT.Z_KI_LEFT - FMT.Z_KI_GAP * (nKis - 1)) / nKis;

  spec.colHeaders.forEach(function (ki, c) {
    var x = FMT.Z_KI_LEFT + c * (kiW + FMT.Z_KI_GAP);
    var lbl = insetBox_(slide, x, FMT.Z_KI_LABEL_TOP, kiW, FMT.Z_KI_LABEL_H);
    lbl.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(lbl, ki, FMT.Z_KI_LABEL_SIZE, FMT.HEADER_COLOR, true, 'CENTER');

    drawTile_(slide, x, FMT.Z_KI_TILE_TOP, kiW, FMT.Z_KI_TILE_H,
              spec.kis[ki], false, spec.bands,
              FMT.Z_KI_PCT_SIZE, FMT.Z_KI_OF_SIZE);
  });

  drawRule_(slide, FMT.Z_HEAD_RULE_Y);

  // --- Roster label line: count on the left, monthly goal on the right ---
  var roster = spec.roster;
  var people = roster.people;
  var m = rosterMetrics_(people.length);

  var sec = insetBox_(slide, FMT.MARGIN_L, FMT.Z_ROSTER_LABEL_TOP,
                      300, FMT.Z_ROSTER_LABEL_H);
  sec.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  styleText_(sec, 'HAS A BAPTISMAL DATE  (' + people.length + ')',
             FMT.Z_ROSTER_LABEL_SIZE, FMT.MLC_SECTION_COLOR, true, 'START');

  if (roster.goal) {
    var chipX = FMT.RIGHT_EDGE - FMT.Z_GOAL_CHIP_W;
    var chip = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
                                 chipX, FMT.Z_ROSTER_LABEL_TOP - FMT.Z_GOAL_CHIP_RISE,
                                 FMT.Z_GOAL_CHIP_W, FMT.Z_GOAL_CHIP_H);
    paintShape_(chip, FMT.Z_GOAL_FILL);
    chip.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(chip, roster.goal, FMT.Z_GOAL_SIZE, FMT.WHITE, true, 'CENTER');

    var chipLbl = insetBox_(slide, chipX - FMT.Z_GOAL_LABEL_W - FMT.Z_GOAL_LABEL_GAP,
                            FMT.Z_ROSTER_LABEL_TOP,
                            FMT.Z_GOAL_LABEL_W, FMT.Z_ROSTER_LABEL_H);
    chipLbl.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(chipLbl, 'MONTHLY BAPTISM GOAL', FMT.Z_ROSTER_LABEL_SIZE,
               FMT.MLC_SECTION_COLOR, true, 'END');
  }

  if (!people.length) {
    var empty = insetBox_(slide, FMT.MARGIN_L, FMT.Z_ROSTER_TOP,
                          FMT.RIGHT_EDGE - FMT.MARGIN_L, 20);
    styleText_(empty, 'No one currently has a baptismal date.',
               11, FMT.OF_COLOR, false, 'START');
    markGenerated_(slide, spec.title);
    return slide;
  }

  var rows = people;
  var soon = soonCutoff_();
  var tableW = FMT.RIGHT_EDGE - FMT.MARGIN_L;

  // Alternating row shading, drawn before the text so it sits underneath.
  // Safe to band horizontally now that row pitch is fixed and no cell can
  // wrap — every column advances in lockstep, so a stripe always lands on
  // the row it belongs to.
  for (var i = 1; i < rows.length; i += 2) {
    var stripe = slide.insertShape(SlidesApp.ShapeType.RECTANGLE,
                                   FMT.MARGIN_L,
                                   FMT.Z_ROSTER_TOP + i * m.rowH + m.stripeY,
                                   tableW, m.rowH);
    paintShape_(stripe, FMT.Z_STRIPE_FILL);
  }

  drawRule_(slide, FMT.Z_ROSTER_RULE_Y);

  // Header row, then one text box per column holding every row as a
  // paragraph. Seven shapes instead of one per cell — the roster stays
  // fast enough to render nine zones inside the execution limit. Every
  // cell is pre-clipped, so no column can wrap and desync from the rest.
  x = FMT.MARGIN_L;
  FMT.ROSTER_COLS.forEach(function (col) {
    var head = insetBox_(slide, x, FMT.Z_ROSTER_HEAD_TOP, col.w, FMT.Z_ROSTER_HEAD_H);
    head.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    styleText_(head, col.head, FMT.Z_ROSTER_HEAD_SIZE,
               FMT.Z_ROSTER_HEAD_COLOR, true, col.align);

    // MIDDLE, not TOP. With the box exactly as tall as the block of rows,
    // centring pins the block to the box centre — which is the middle of
    // the stripe grid — no matter what internal inset Slides applies.
    // Under TOP alignment the first line starts at boxTop + inset, so any
    // error in TEXT_INSET shifted every row by the same amount, which is
    // exactly the constant offset seen in the last render.
    var body = insetBox_(slide, x, FMT.Z_ROSTER_TOP, col.w, m.height);
    body.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
    var tr = body.getText();
    tr.setText(rows.map(function (p) { return rosterCellText_(p, col); }).join('\n'));
    tr.getTextStyle()
      .setFontFamily(FMT.FONT).setFontSize(m.font).setBold(false)
      .setForegroundColor(FMT.Z_TEXT_COLOR);

    // Line spacing is left untouched on purpose — see Z_LINE_NORMAL.
    var ps = tr.getParagraphStyle();
    ps.setParagraphAlignment(SlidesApp.ParagraphAlignment[col.align]);
    ps.setSpaceAbove(0);
    ps.setSpaceBelow(0);
    try { body.getBorder().setTransparent(); } catch (e) {}

    // Per-row colour: glyphs green/red, imminent dates green and bold.
    if (col.glyph || col.key === 'date') {
      var paras = tr.getParagraphs();
      rows.forEach(function (p, i) {
        if (i >= paras.length) return;
        var style = paras[i].getRange().getTextStyle();
        if (col.glyph) {
          style.setForegroundColor(p[col.key] ? FMT.Z_YES_COLOR : FMT.Z_NO_COLOR)
               .setBold(true);
        } else if (isSoon_(p.date, soon) && !p.done) {
          style.setForegroundColor(FMT.Z_SOON_COLOR).setBold(true);
        }
      });
    }
    x += col.w;
  });

  markGenerated_(slide, spec.title);
  return slide;
}

/*** DRAWING — MLC SHARE ***/

function drawMlcSlide_(deck, spec) {
  var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);

  var nCols = spec.colHeaders.length;
  var gridLeft = FMT.MARGIN_L + FMT.MLC_LABEL_W;
  var gridW = FMT.RIGHT_EDGE - gridLeft;
  var cellW = (gridW - FMT.GAP_X * (nCols - 1)) / nCols;

  drawChrome_(slide, spec);
  drawHeaders_(slide, spec.colHeaders, gridLeft, cellW);

  var labelTops = [FMT.MLC_BLOCK1_LABEL, FMT.MLC_BLOCK2_LABEL];

  spec.blocks.forEach(function (block, b) {
    var labelY = labelTops[b];

    var sec = slide.insertTextBox('', FMT.MARGIN_L, labelY, FMT.MLC_LABEL_W + 60, 12);
    styleText_(sec, block.label, FMT.MLC_SECTION_SIZE, FMT.MLC_SECTION_COLOR, true, 'START');

    var rowDefs = [
      { label: 'Mission total', kind: 'plain', pick: function (k) { return k.goal; } },
      { label: 'MLC areas',     kind: 'plain', pick: function (k) { return k.actual; } },
      { label: 'MLC share',     kind: 'share' }
    ];

    rowDefs.forEach(function (def, r) {
      var y = labelY + FMT.MLC_SECTION_GAP + r * (FMT.MLC_ROW_H + FMT.MLC_ROW_GAP);

      var lbl = slide.insertTextBox('', FMT.MARGIN_L, y, FMT.MLC_LABEL_W - 8, FMT.MLC_ROW_H);
      lbl.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
      styleText_(lbl, def.label, 11, FMT.LABEL_COLOR, true, 'START');

      spec.colHeaders.forEach(function (ki, c) {
        var x = gridLeft + c * (cellW + FMT.GAP_X);
        var cell = block.kis[ki];
        var shape = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
                                      x, y, cellW, FMT.MLC_ROW_H);
        shape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);

        var txt, size, color;
        if (def.kind === 'plain') {
          paintShape_(shape, FMT.MLC_PLAIN_FILL);
          txt = String(def.pick(cell));
          size = FMT.MLC_PLAIN_SIZE;
          color = FMT.MLC_PLAIN_TEXT;
        } else {
          paintShape_(shape, FMT.PALETTE[bandFor_(cell, spec.bands)].solid);
          txt = pctText_(cell);
          size = FMT.MLC_SHARE_SIZE;
          color = FMT.WHITE;
        }
        styleText_(shape, txt, size, color, true, 'CENTER');
      });
    });
  });

  drawLegend_(slide, spec.legend, FMT.MLC_LEGEND_Y);
  markGenerated_(slide, spec.title);
  return slide;
}

/*** PRIMITIVES ***/

/** Filled, never outlined. */
function paintShape_(shape, hex) {
  shape.getFill().setSolidFill(hex);
  shape.getBorder().setTransparent();
}

function styleText_(shape, str, size, color, bold, align) {
  var tr = shape.getText();
  tr.setText(str || '');
  tr.getTextStyle()
    .setFontFamily(FMT.FONT).setFontSize(size).setBold(!!bold)
    .setForegroundColor(color);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment[align]);
  try { shape.getBorder().setTransparent(); } catch (e) {}
}

/*** BANDS ***/

function pct_(cell) {
  if (!cell || !cell.goal) return 0;
  return cell.actual / cell.goal;
}

function pctText_(cell) {
  if (!cell) return '—';
  // A goal of 0 has nothing to compute a percentage against. If the zone
  // still baptized someone, show the plain count rather than a blank —
  // it's an achievement nobody set a target for, not a lack of data.
  if (!cell.goal) return cell.actual > 0 ? String(cell.actual) : '—';
  return Math.round(pct_(cell) * 100) + '%';
}

function bandFor_(cell, bands) {
  bands = bands || FMT.BANDS_GOAL;
  if (!cell) return 'none';
  // Same reasoning as pctText_: an unset goal met with a positive actual
  // reads as top-tier, not gray. A true 0-of-0 stays gray.
  if (!cell.goal) return cell.actual > 0 ? 'upper' : 'none';
  var p = pct_(cell);
  if (p >= bands.high) return 'upper';
  if (p >= bands.mid) return 'middle';
  return 'under';
}

/*** GENERATED-SLIDE TRACKING ***/

function markGenerated_(slide, label) {
  try {
    slide.getNotesPage().getSpeakerNotesShape().getText()
         .setText(FMT.MARK + ' ' + label + ' · ' + new Date().toISOString());
  } catch (e) {}
}

function clearGenerated_(deck) {
  var slides = deck.getSlides();
  var n = 0;
  for (var i = slides.length - 1; i >= 0; i--) {
    var notes = '';
    try {
      notes = slides[i].getNotesPage().getSpeakerNotesShape().getText().asString();
    } catch (e) { continue; }
    if (notes.indexOf(FMT.MARK) === 0) { slides[i].remove(); n++; }
  }
  return n;
}

/**
 * Finds the manually-maintained Social Media slide — identified by
 * "[Social Media]" anywhere in its speaker notes, deliberately distinct
 * from [AUTOGEN] so clearGenerated_() never touches it — and moves it to
 * the very end of the deck.
 *
 * Autogenerated slides are always appended fresh to the end during a
 * refresh, so without this step the manual slide would drift back to
 * wherever it happened to sit before the refresh instead of staying
 * last. If more than one slide matches, only the first found is moved;
 * a note is logged so a stray duplicate gets noticed rather than
 * silently reordered.
 */
function pinSocialMediaSlideToEnd_(deck) {
  var slides = deck.getSlides();
  var matches = [];
  for (var i = 0; i < slides.length; i++) {
    var notes = '';
    try {
      notes = slides[i].getNotesPage().getSpeakerNotesShape().getText().asString();
    } catch (e) { continue; }
    if (notes.indexOf(FMT.SOCIAL_MARK) !== -1) matches.push(slides[i]);
  }
  if (!matches.length) return { found: false, count: 0 };
  matches[0].move(slides.length - 1);
  return { found: true, count: matches.length };
}

/*** SHEET READERS ***/

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/[%,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Sheets render these as ✓/✗ glyphs; checkboxes would arrive as booleans. */
function truthy_(v) {
  if (v === true) return true;
  if (v === false || v === '' || v === null || v === undefined) return false;
  var s = String(v).trim();
  if (/^(true|yes|y|1|x2|done)$/i.test(s)) return true;
  return s.indexOf('✓') !== -1 || s.indexOf('✔') !== -1;
}

function fmtDate_(v) {
  if (v instanceof Date) return (v.getMonth() + 1) + '/' + v.getDate();
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
  return m ? m[1] + '/' + m[2] : s;
}

/**
 * The window a baptism date counts as imminent, highlighted green.
 *
 * Runs from today through the coming Sunday only — the rest of this
 * week plus the upcoming weekend. A date that falls the weekend after
 * next is not highlighted.
 */
function soonCutoff_() {
  var from = new Date();
  from.setHours(0, 0, 0, 0);

  var to = new Date(from.getTime());
  to.setDate(to.getDate() + ((7 - to.getDay()) % 7));  // out through the coming Sunday
  to.setHours(23, 59, 59, 999);

  return { from: from, to: to };
}

function isSoon_(v, win) {
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return false;
  return d >= win.from && d <= win.to;
}

/*** PORTAL READER ***/

/**
 * GET {PORTAL_URL}/api/slides/{mode}[?week=] with the bearer secret.
 * The response is numbers only (see src/server/slides.ts in the portal
 * repository for the shape). Throws with the portal's message on anything
 * but 200, and names the usual causes.
 */
function fetchPortal_(mode) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty('PORTAL_URL');
  var secret = props.getProperty('SLIDES_SECRET');
  if (!base || !secret) {
    throw new Error('Set PORTAL_URL and SLIDES_SECRET in Project Settings → Script Properties.');
  }

  var path = '/api/slides/' + mode + (SRC.WEEK ? '?week=' + encodeURIComponent(SRC.WEEK) : '');
  var res = UrlFetchApp.fetch(base.replace(/\/+$/, '') + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    var msg = body;
    try { msg = JSON.parse(body).error || body; } catch (e) {}
    var hint = code === 401 ? ' (check SLIDES_SECRET)'
             : /<html/i.test(body) ? ' (Cloudflare Access is in the way: add a Bypass rule for the path api/slides)'
             : '';
    throw new Error('Portal ' + path + ' answered ' + code + ': ' + String(msg).slice(0, 200) + hint);
  }
  var data;
  try { data = JSON.parse(body); } catch (e) { throw new Error('Portal ' + path + ' did not return JSON.'); }
  checkShape_(data, path);
  return data;
}

/** Every zone and the mission row must carry all of SRC.KIS. */
function checkShape_(data, path) {
  if (!data || !Array.isArray(data.zones) || !data.mission) {
    throw new Error('Portal ' + path + ' response is missing zones or mission.');
  }
  var rows = data.zones.map(function (z) { return z.kis; }).concat([data.mission]);
  rows.forEach(function (kis) {
    SRC.KIS.forEach(function (ki) {
      if (!kis || !kis[ki] || typeof kis[ki].actual !== 'number') {
        throw new Error('Portal ' + path + ' response lacks ' + ki + ' on a row; ' +
                        'the portal and this script disagree on the indicator codes.');
      }
    });
  });
}

function zeroKis_() {
  var out = {};
  SRC.KIS.forEach(function (ki) { out[ki] = { goal: 0, actual: 0 }; });
  return out;
}

/** The roster whose tab name matches a portal zone name, ignoring case. */
function rosterFor_(rosters, zone) {
  if (rosters[zone]) return rosters[zone];
  var want = String(zone).toLowerCase();
  var keys = Object.keys(rosters);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === want) return rosters[keys[i]];
  }
  return null;
}

/**
 * One tab per zone in Baptisms (MLC). Discovered by name, so a transfer
 * that changes who is on the list needs no code change; only a tab rename
 * would. Hidden tabs are skipped. Returns {zone: {goal, people[]}}.
 */
function readRosters_(notes) {
  var out = {};
  var ss, matched = [];
  try {
    ss = SpreadsheetApp.openById(SRC.SS_BAPTISMS);
  } catch (e) {
    notes.push('Baptisms (MLC) unreadable, all zone slides skipped: ' + e.message);
    return out;
  }

  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    var m = name.match(SRC.ROSTER_TAB_RE);
    if (!m) return;
    var zone = m[1].trim();
    if (sh.isSheetHidden()) return;
    out[zone] = readRoster_(sh, zone, notes);
    matched.push(name);
  });

  if (!matched.length) {
    notes.push('WARNING: no tabs in Baptisms (MLC) matched ' + SRC.ROSTER_TAB_RE +
               '. Zone slides will be skipped.');
  } else {
    notes.push('Roster tabs read (' + matched.length + '): ' + matched.join(', '));
  }
  return out;
}

function readRoster_(sh, zone, notes) {
  var vals = sh.getRange('B2:H' + SRC.ROSTER_LAST_ROW).getValues();

  var titleCell = String(vals[0][0]).trim();   // B2
  var goal = String(vals[0][2]).trim();        // D2, e.g. "4/8"
  if (titleCell && titleCell.toLowerCase() !== zone.toLowerCase()) {
    notes.push('NOTE: tab "' + sh.getName() + '" has "' + titleCell +
               '" in B2 — tab name and header disagree.');
  }

  var people = [];
  for (var r = 2; r < vals.length; r++) {      // sheet row 4 onward
    var name = String(vals[r][0]).trim();
    if (!name) continue;
    people.push({
      name: name,
      date: vals[r][1],
      church: truthy_(vals[r][2]),
      calendar: truthy_(vals[r][3]),
      ward: String(vals[r][4]).trim(),
      missionaries: String(vals[r][5]).trim(),
      done: truthy_(vals[r][6])
    });
  }

  if (people.length && people.length >= SRC.ROSTER_LAST_ROW - 3) {
    notes.push('WARNING: ' + zone + ' filled the scan range — raise ' +
               'SRC.ROSTER_LAST_ROW, names may be missing.');
  }
  return { zone: zone, goal: goal, people: people };
}

/*** GATHERERS ***/

function gatherWeekly_() {
  var data = fetchPortal_('weekly');
  var notes = (data.notes || []).slice();
  notes.push('Portal: ' + data.subtitle + ' (week of ' + data.week + '), ' +
             data.zones.length + ' zone(s).');

  var rosters = readRosters_(notes);
  var zoneNames = data.zones.map(function (z) { return z.name.toLowerCase(); });
  var orphans = Object.keys(rosters).filter(function (k) {
    return zoneNames.indexOf(k.toLowerCase()) === -1;
  });
  if (orphans.length) {
    notes.push('Roster tab(s) with no matching zone in the portal (renamed?): ' + orphans.join(', '));
  }

  return {
    subtitle: data.subtitle,
    zones: data.zones.map(function (z) {
      var roster = rosterFor_(rosters, z.name);
      // The goal chip: from the portal when a goal is set there (Admin → Baptism
      // goals), else whatever the tab's D2 cell says.
      if (roster && z.baptisms && z.baptisms.goal) {
        roster.goal = z.baptisms.actual + '/' + z.baptisms.goal;
      }
      return { name: z.name, kis: z.kis, detail: null, roster: roster };
    }),
    mission: data.mission,
    mlc: data.mlc,
    notes: notes
  };
}

function gatherMonthly_() {
  var data = fetchPortal_('monthly');
  var notes = (data.notes || []).slice();
  notes.push('Portal: ' + data.subtitle + ', weeks of ' + (data.window || []).join(', ') + '.');
  return {
    subtitle: data.subtitle,
    zones: data.zones.map(function (z) {
      return {
        name: z.name,
        kis: z.kis,
        detail: (z.detail || []).map(function (w) { return { label: w.label, kis: w.kis }; })
      };
    }),
    mission: data.mission,
    mlc: data.mlc,
    notes: notes
  };
}

function sumKis_(list) {
  var out = {};
  SRC.KIS.forEach(function (ki) { out[ki] = { goal: 0, actual: 0 }; });
  list.forEach(function (k) {
    if (!k) return;
    SRC.KIS.forEach(function (ki) {
      out[ki].goal += k[ki].goal;
      out[ki].actual += k[ki].actual;
    });
  });
  return out;
}

function missionTotal_(m) {
  var t = 0;
  SRC.KIS.forEach(function (ki) { t += m[ki].actual; });
  return t;
}

/*** DIAGNOSTICS ***/

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function padL_(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

function fitNote_(m) {
  return 'font ' + m.font.toFixed(1) + 'pt, rowH ' + m.rowH.toFixed(1) +
         'pt, ' + m.visible + ' fit on-slide, drawing ' + m.shown +
         (m.overflow ? '   <-- last ' + m.hidden + ' spill off the bottom' : '');
}

/** The numbers the portal returned, both modes. */
function dumpPortal() {
  var out = [];
  ['weekly', 'monthly'].forEach(function (mode) {
    out.push('--- portal /api/slides/' + mode + ' ---');
    var d;
    try { d = fetchPortal_(mode); }
    catch (e) { out.push('ERROR: ' + e.message); out.push(''); return; }

    out.push('week ' + d.week + '   subtitle "' + d.subtitle + '"   weeks summed: ' +
             (d.window || []).join(', '));
    (d.notes || []).forEach(function (n) { out.push('  ' + n); });
    var cell = function (k) { return function (c) { return padL_(c[k].actual + '/' + c[k].goal, 12); }; };
    var line = function (label, kis) {
      return pad_(label, 20) + SRC.KIS.map(function (k) { return cell(k)(kis); }).join('');
    };
    out.push(pad_('', 20) + SRC.KIS.map(function (k) { return padL_(k, 12); }).join(''));
    d.zones.forEach(function (z) { out.push(line(z.name, z.kis)); });
    out.push(line('MISSION', d.mission));
    if (d.mlc && d.mlc.thisWeek) out.push(line('MLC this week', d.mlc.thisWeek));
    if (d.mlc && d.mlc.lastWeek) out.push(line('MLC last week', d.mlc.lastWeek));
    out.push('');
  });
  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/** Every roster tab, with the fit metrics each one would render at. */
function dumpRosters() {
  var notes = [];
  var rosters = readRosters_(notes);
  var out = notes.slice();
  out.push('');

  Object.keys(rosters).forEach(function (z) {
    var r = rosters[z];
    var m = rosterMetrics_(r.people.length);
    out.push('--- ' + z + '  goal ' + (r.goal || '(none)') +
             '  ·  ' + r.people.length + ' on date');
    out.push('    fit: ' + fitNote_(m));
    r.people.forEach(function (p) {
      out.push('      ' + pad_(p.name, 26) + pad_(fmtDate_(p.date), 8) +
               pad_(p.church ? 'ch' : '..', 4) + pad_(p.calendar ? 'cal' : '...', 5) +
               pad_(p.done ? 'BAP' : '...', 5) + pad_(p.ward, 18) + p.missionaries);
    });
    out.push('');
  });

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

function dumpAll() {
  var parts = [];
  [['PORTAL', dumpPortal], ['ROSTERS', dumpRosters]].forEach(function (p) {
    try { parts.push(p[1]()); }
    catch (e) { parts.push('--- ' + p[0] + ' ---\nERROR: ' + e.message); }
    parts.push('');
  });
  var text = parts.join('\n');
  Logger.log(text);
  return text;
}

/*** STRIPE CALIBRATION ***/

/**
 * Draws one calibration slide into the weekly deck and nothing else.
 *
 * Stripe alignment depends on where Slides puts glyphs inside a line box,
 * which no API call reports — it can only be observed. This slide makes
 * it observable: red hairlines mark the exact row boundaries the stripes
 * are drawn on, with sample text on top of them.
 *
 * Screenshot the slide and read it:
 *   text centred between each pair of red lines  -> nothing to change
 *   text riding high (gap beneath)               -> lower Z_STRIPE_NUDGE
 *   text riding low (gap above)                  -> raise Z_STRIPE_NUDGE
 * One point of nudge moves the stripe one point. The slide is marked
 * generated, so the next refreshWeekly() clears it.
 */
function calibrateStripes() {
  var deck = SlidesApp.openById(DECK.WEEKLY);
  var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  var n = 12;
  var m = rosterMetrics_(n);
  var col = FMT.ROSTER_COLS[0];

  drawChrome_(slide, {
    title: 'Stripe calibration',
    subtitle: FMT.Z_ROW_FONT + 'pt · pitch ' + m.rowH.toFixed(2) +
              'pt · nudge ' + FMT.Z_STRIPE_NUDGE + 'pt'
  });

  for (var i = 1; i < n; i += 2) {
    var stripe = slide.insertShape(SlidesApp.ShapeType.RECTANGLE,
                                   FMT.MARGIN_L,
                                   FMT.Z_ROSTER_TOP + i * m.rowH + m.stripeY,
                                   FMT.RIGHT_EDGE - FMT.MARGIN_L, m.rowH);
    paintShape_(stripe, FMT.Z_STRIPE_FILL);
  }

  var body = insetBox_(slide, FMT.MARGIN_L, FMT.Z_ROSTER_TOP, col.w, m.height);
  body.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  var lines = [];
  for (var r = 0; r < n; r++) lines.push('Hxy row ' + r + ' Ëgjpq');
  var tr = body.getText();
  tr.setText(lines.join('\n'));
  tr.getTextStyle().setFontFamily(FMT.FONT).setFontSize(m.font)
    .setForegroundColor(FMT.Z_TEXT_COLOR);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);
  tr.getParagraphStyle().setSpaceAbove(0);
  tr.getParagraphStyle().setSpaceBelow(0);

  // Hairlines on the exact grid the stripes use.
  for (var k = 0; k <= n; k++) {
    var y = FMT.Z_ROSTER_TOP + k * m.rowH + m.stripeY;
    var line = slide.insertLine(SlidesApp.LineCategory.STRAIGHT,
                                FMT.MARGIN_L, y, FMT.MARGIN_L + col.w + 90, y);
    line.getLineFill().setSolidFill('#E03131');
    line.setWeight(0.5);
  }

  markGenerated_(slide, 'Stripe calibration');
  var msg = 'Calibration slide appended to ' + deck.getName() +
            '. Text should sit centred between each pair of red lines.';
  Logger.log(msg);
  return msg;
}

/*** DRY RUN ***/

/**
 * Previews every slide that would be drawn, cell by cell. Writes nothing.
 * A trailing * marks a solid-filled (summary) tile.
 */
function dryRun() {
  var out = [];

  ['weekly', 'monthly'].forEach(function (mode) {
    out.push('==================== ' + mode.toUpperCase() + ' ====================');
    var plan;
    try {
      plan = buildSpecs_(mode);
    } catch (e) {
      out.push('  ERROR: ' + e.message);
      out.push('');
      return;
    }

    plan.notes.forEach(function (n) { out.push('  ' + n); });
    out.push('  ' + plan.specs.length + ' slide(s) would be drawn.');
    out.push('  (The manually-maintained Social Media slide, if present, is pinned ' +
             'to the end separately and does not appear in this count.)');
    out.push('');

    plan.specs.forEach(function (spec, i) {
      out.push('  [' + (i + 1) + '] ' + spec.title +
               (spec.subtitle ? FMT.TITLE_GAP + spec.subtitle : ''));

      if (spec.kind === 'mlc') {
        out.push('      ' + pad_('', 16) +
                 spec.colHeaders.map(function (h) { return padL_(h, 12); }).join(''));
        spec.blocks.forEach(function (b) {
          out.push('      ' + b.label);
          out.push('        ' + pad_('Mission total', 14) +
                   spec.colHeaders.map(function (ki) { return padL_(b.kis[ki].goal, 12); }).join(''));
          out.push('        ' + pad_('MLC areas', 14) +
                   spec.colHeaders.map(function (ki) { return padL_(b.kis[ki].actual, 12); }).join(''));
          out.push('        ' + pad_('MLC share', 14) +
                   spec.colHeaders.map(function (ki) {
                     return padL_(pctText_(b.kis[ki]) + '*', 12);
                   }).join(''));
        });

      } else if (spec.kind === 'zone') {
        out.push('      ' + spec.colHeaders.map(function (h) { return padL_(h, 15); }).join(''));
        out.push('      ' + spec.colHeaders.map(function (ki) {
          var c = spec.kis[ki];
          return padL_(pctText_(c) + ' ' + c.actual + '/' + c.goal, 15);
        }).join(''));

        var r = spec.roster;
        var m = rosterMetrics_(r.people.length);
        out.push('      ON A BAPTISMAL DATE (' + r.people.length + ')   goal ' +
                 (r.goal || '(none)'));
        out.push('      fit: ' + fitNote_(m));
        r.people.forEach(function (p) {
          out.push('        ' + pad_(p.name, 24) + pad_(fmtDate_(p.date), 8) +
                   pad_(p.church ? FMT.Z_YES : FMT.Z_NO, 3) +
                   pad_(p.calendar ? FMT.Z_YES : FMT.Z_NO, 3) +
                   pad_(p.done ? FMT.Z_YES : FMT.Z_NO, 4) +
                   pad_(p.ward, 18) + p.missionaries);
        });

      } else {
        out.push('      ' + pad_('', 20) +
                 spec.colHeaders.map(function (h) { return padL_(h, 15); }).join(''));
        spec.rows.forEach(function (row, r) {
          var rowSolid = spec.solidRows.indexOf(r) !== -1;
          var line = spec.colHeaders.map(function (h, c) {
            var cell = row.cells[c];
            var solid = rowSolid || spec.solidCols.indexOf(c) !== -1;
            return padL_(pctText_(cell) + ' ' + cell.actual + '/' + cell.goal +
                         (solid ? '*' : ''), 15);
          }).join('');
          out.push('      ' + pad_(row.label, 20) + line);
        });
      }
      out.push('');
    });
  });

  var text = out.join('\n');
  Logger.log(text);
  return text;
}