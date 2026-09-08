// Seeded into a new account so the dashboard opens on a real structure instead
// of an empty screen. Transcribed from the source spreadsheet: each group is a
// block separated by a blank row, and a `color` marks a highlighted row.

const row = (role, name, year, school, color = "") => ({
  role,
  name,
  year,
  school,
  color,
});

const TEMPLATE = {
  title: "XIII A",
  groups: [
    {
      rows: [
        row("CGL", "Isaac Ong", "Y4", "RP", "rose"),
        row("PTL", "Josh Lee", "Y2", "TP", "cyan"),
        row("R", "Ian Koh", "", "OVS"),
      ],
    },
    {
      rows: [
        row("PCGL", "Ryan Fooh", "Y4", "SP", "yellow"),
        row("I", "Dylan Soh", "Y2", "TP"),
      ],
    },
    {
      rows: [
        row("TL", "Ashton Tay", "Y2", "TP", "peach"),
        row("GI", "Malcom", "Y1", "ITE"),
        row("G", "Jacob", "Y1", "ITE"),
        row("G", "Julian", "", "OVS"),
      ],
    },
    {
      rows: [
        row("OTL", "Cedric Ong", "Y2", "RP", "peach"),
        row("G", "Toby", "Y2", "TP"),
      ],
    },
    {
      rows: [
        row("PTL", "Kayes Tan", "Y1", "RP", "peach"),
        row("G", "Louis", "Sec 3", "Dunman"),
      ],
    },
    {
      rows: [
        row("PTL", "Ashton Heng", "Y2", "SP", "cyan"),
        row("G", "Anderson", "Y2", "SP"),
      ],
    },
    {
      rows: [
        row("OTL", "Glynnis Tan", "", "", "lavender"),
        row("G", "Willemyn", "Y1", "NP"),
        row("G", "Joelle", "Y1", "NP"),
        row("G", "Tze Xuan", "Y1", ""),
        row("G", "Crystabelle", "Sec 2", "CHIJ"),
      ],
    },
  ],
};

module.exports = { TEMPLATE };
