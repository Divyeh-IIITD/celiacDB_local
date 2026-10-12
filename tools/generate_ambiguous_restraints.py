"""Generate HADDOCK-style ambiguous interaction restraints (AIR) from residue lists."""

import argparse
import re
from pathlib import Path


def parse_residues(value):
    """
    Parse residue strings like:
      - "135, 165, 435"
      - "1-15"
      - "1 to 15"
      - "135 165 435"
    """
    if isinstance(value, list):
        value = ",".join(map(str, value))

    residues = set()
    tokens = re.split(r"[,;\s]+", str(value).strip())

    for token in tokens:
        if not token:
            continue
        range_match = re.match(r"^(\d+)\s*(?:-|to)\s*(\d+)$", token, re.IGNORECASE)
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            if start > end:
                start, end = end, start
            residues.update(range(start, end + 1))
        elif token.isdigit():
            residues.add(int(token))
        else:
            raise ValueError(f"Invalid residue specification: '{token}'")

    if not residues:
        raise ValueError("At least one active residue number is required")

    return sorted(list(residues))


def generate_air_content(receptor_residues, peptide_residues, receptor_segid="A", peptide_segid="B"):
    """
    Generate HADDOCK / CNS format ambiguous interaction restraint (AIR) table.
    """
    rec_res_list = parse_residues(receptor_residues)
    pep_res_list = parse_residues(peptide_residues)

    lines = [
        "! ====================================================================",
        "! HADDOCK Ambiguous Interaction Restraints (AIR)",
        f"! Target Receptor: segid {receptor_segid} (Active residues: {len(rec_res_list)})",
        f"! Target Peptide:  segid {peptide_segid} (Active residues: {len(pep_res_list)})",
        "! Format: CNS distance restraint (lower=2.0A, upper=2.0A, dminus=0.0A)",
        "! ====================================================================",
        "",
    ]

    # For each active residue on the receptor, define ambiguous restraint to active peptide residues
    pep_or_clause = " or ".join(f"resid {r}" for r in pep_res_list)
    for rec_res in rec_res_list:
        lines.append(f"assign (segid {receptor_segid} and resid {rec_res})")
        lines.append(f"       (segid {peptide_segid} and ({pep_or_clause}))")
        lines.append("       2.0 2.0 0.0\n")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Generate HADDOCK AIR restraints file (.tbl)")
    parser.add_argument("--receptor", required=True, help="Receptor active residues (e.g. 135,165,435 or 1-20)")
    parser.add_argument("--peptide", required=True, help="Peptide active residues (e.g. 1-15 or all)")
    parser.add_argument("--receptor-segid", default="A", help="Receptor segment/chain ID (default: A)")
    parser.add_argument("--peptide-segid", default="B", help="Peptide segment/chain ID (default: B)")
    parser.add_argument("--output", required=True, help="Output .tbl file path")
    args = parser.parse_args()

    content = generate_air_content(
        args.receptor,
        args.peptide,
        receptor_segid=args.receptor_segid,
        peptide_segid=args.peptide_segid,
    )
    Path(args.output).write_text(content, encoding="ascii")
    print(f"Wrote restraints to {args.output}")


if __name__ == "__main__":
    main()