"""
Build three starting peptide conformers (helix, sheet, ppii) and the multi-model
ensemble using native PyMOL installation.
"""

import argparse
import json
import os
import sys

try:
    from pymol import cmd
except ImportError:
    print("Run this script with PyMOL's Python interpreter.", file=sys.stderr)
    raise


def extract_atom_lines(pdb_path):
    """Extract ATOM/HETATM lines from a PDB file."""
    lines = []
    with open(pdb_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith(("ATOM", "HETATM")):
                lines.append(line)
    return lines


def build_conformers(sequence, output_dir, chain="B"):
    sequence = sequence.strip().upper()
    if not sequence or any(residue not in "ACDEFGHIKLMNPQRSTVWY" for residue in sequence):
        raise ValueError("Sequence must contain only standard one-letter amino-acid codes.")

    if len(sequence) < 3 or len(sequence) > 50:
        raise ValueError(f"Peptide length must be between 3 and 50 residues (got {len(sequence)}).")

    os.makedirs(output_dir, exist_ok=True)
    cmd.reinitialize()

    # 1. Helix conformation (alpha helix ss=1)
    helix_name = "peptide_helix"
    cmd.fab(sequence, helix_name, ss=1, chain=chain)
    cmd.remove("solvent")
    cmd.h_add(helix_name)
    cmd.alter(helix_name, f"chain='{chain}'")

    # 2. Beta sheet conformation (anti-parallel beta sheet ss=2)
    sheet_name = "peptide_sheet"
    cmd.fab(sequence, sheet_name, ss=2, chain=chain)
    cmd.remove("solvent")
    cmd.h_add(sheet_name)
    cmd.alter(sheet_name, f"chain='{chain}'")

    # 3. Polyproline II (PPII) conformation
    # Standard PPII dihedral angles: phi = -75 degrees, psi = +145 degrees
    ppii_name = "peptide_ppii"
    cmd.fab(sequence, ppii_name, ss=4, chain=chain)
    cmd.remove("solvent")

    seq_len = len(sequence)
    for i in range(1, seq_len + 1):
        if i > 1:
            try:
                cmd.set_dihedral(
                    f"{ppii_name} and chain {chain} and resi {i-1} and name C",
                    f"{ppii_name} and chain {chain} and resi {i} and name N",
                    f"{ppii_name} and chain {chain} and resi {i} and name CA",
                    f"{ppii_name} and chain {chain} and resi {i} and name C",
                    -75.0,
                )
            except Exception:
                pass
        if i < seq_len:
            try:
                cmd.set_dihedral(
                    f"{ppii_name} and chain {chain} and resi {i} and name N",
                    f"{ppii_name} and chain {chain} and resi {i} and name CA",
                    f"{ppii_name} and chain {chain} and resi {i} and name C",
                    f"{ppii_name} and chain {chain} and resi {i+1} and name N",
                    145.0,
                )
            except Exception:
                pass

    cmd.h_add(ppii_name)
    cmd.alter(ppii_name, f"chain='{chain}'")

    AA3 = {
        'A': 'ALA', 'C': 'CYS', 'D': 'ASP', 'E': 'GLU', 'F': 'PHE',
        'G': 'GLY', 'H': 'HIS', 'I': 'ILE', 'K': 'LYS', 'L': 'LEU',
        'M': 'MET', 'N': 'ASN', 'P': 'PRO', 'Q': 'GLN', 'R': 'ARG',
        'S': 'SER', 'T': 'THR', 'V': 'VAL', 'W': 'TRP', 'Y': 'TYR'
    }
    start_res = AA3.get(sequence[0], 'GLY')
    end_res = AA3.get(sequence[-1], 'GLY')
    seq_len = len(sequence)

    helix_header = f"HELIX    1   1 {start_res:>3} {chain} {1:>4}  {end_res:>3} {chain} {seq_len:>4}  1 {seq_len:>35}"
    sheet_header = f"SHEET    1   A 1 {start_res:>3} {chain} {1:>4}  {end_res:>3} {chain} {seq_len:>4}  0"
    ppii_header  = f"HELIX    1   1 {start_res:>3} {chain} {1:>4}  {end_res:>3} {chain} {seq_len:>4} 11 {seq_len:>35}"

    # Save individual conformations
    helix_path = os.path.join(output_dir, "peptide_helix.pdb")
    ppii_path = os.path.join(output_dir, "peptide_ppii.pdb")
    sheet_path = os.path.join(output_dir, "peptide_sheet.pdb")
    ensemble_path = os.path.join(output_dir, "peptide_ens.pdb")
    overlay_path = os.path.join(output_dir, "peptide_overlay.pdb")

    cmd.save(helix_path, helix_name)
    cmd.save(ppii_path, ppii_name)
    cmd.save(sheet_path, sheet_name)

    # Prepend explicit secondary structure header records
    helix_lines = extract_atom_lines(helix_path)
    with open(helix_path, "w", encoding="utf-8") as f:
        f.write(f"HEADER    ALPHA-HELIX CONFORMATION\n{helix_header}\n" + "".join(helix_lines) + "TER\nEND\n")

    sheet_lines = extract_atom_lines(sheet_path)
    with open(sheet_path, "w", encoding="utf-8") as f:
        f.write(f"HEADER    BETA-SHEET CONFORMATION\n{sheet_header}\n" + "".join(sheet_lines) + "TER\nEND\n")

    ppii_lines = extract_atom_lines(ppii_path)
    with open(ppii_path, "w", encoding="utf-8") as f:
        f.write(f"HEADER    POLYPROLINE-II CONFORMATION\n{ppii_header}\n" + "".join(ppii_lines) + "TER\nEND\n")

    # Assemble ensemble PDB (MODEL 1: helix, MODEL 2: ppii, MODEL 3: sheet)
    ensemble_content = [
        "REMARK     MODEL 1: ALPHA-HELIX (CHAIN B)",
        "REMARK     MODEL 2: POLYPROLINE-II (CHAIN B)",
        "REMARK     MODEL 3: BETA-SHEET (CHAIN B)",
        "MODEL        1",
        helix_header,
        "".join(helix_lines).rstrip(),
        "ENDMDL",
        "MODEL        2",
        ppii_header,
        "".join(ppii_lines).rstrip(),
        "ENDMDL",
        "MODEL        3",
        sheet_header,
        "".join(sheet_lines).rstrip(),
        "ENDMDL",
        "END\n",
    ]

    with open(ensemble_path, "w", encoding="utf-8") as f:
        f.write("\n".join(ensemble_content))

    # Assemble multi-chain overlay PDB for simultaneous 3D visualization (A=Helix, B=PPII, C=Sheet)
    overlay_helix_lines = [line[:21] + 'A' + line[22:] if line.startswith(('ATOM', 'HETATM')) else line for line in helix_lines]
    overlay_ppii_lines  = [line[:21] + 'B' + line[22:] if line.startswith(('ATOM', 'HETATM')) else line for line in ppii_lines]
    overlay_sheet_lines = [line[:21] + 'C' + line[22:] if line.startswith(('ATOM', 'HETATM')) else line for line in sheet_lines]

    overlay_content = [
        "HEADER    PEPTIDE 3-CONFORMATION OVERLAY",
        f"HELIX    1   1 {start_res:>3} A {1:>4}  {end_res:>3} A {seq_len:>4}  1 {seq_len:>35}",
        f"HELIX    2   2 {start_res:>3} B {1:>4}  {end_res:>3} B {seq_len:>4} 11 {seq_len:>35}",
        f"SHEET    1   A 1 {start_res:>3} C {1:>4}  {end_res:>3} C {seq_len:>4}  0",
        "".join(overlay_helix_lines).rstrip(),
        "TER",
        "".join(overlay_ppii_lines).rstrip(),
        "TER",
        "".join(overlay_sheet_lines).rstrip(),
        "TER\nEND\n"
    ]

    with open(overlay_path, "w", encoding="utf-8") as f:
        f.write("\n".join(overlay_content))

    result = {
        "sequence": sequence,
        "length": len(sequence),
        "chain": chain,
        "conformers": {
            "helix": helix_path,
            "ppii": ppii_path,
            "sheet": sheet_path,
            "ensemble": ensemble_path,
            "overlay": overlay_path,
        },
        "success": True,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Generate 3 peptide conformations (helix, sheet, ppii) and ensemble.")
    parser.add_argument("sequence", help="Peptide sequence in standard one-letter code (e.g., PQLQPL)")
    parser.add_argument("--output-dir", default="conformers", help="Output directory for generated PDB files")
    parser.add_argument("--chain", default="B", help="Chain identifier for the peptide (default: B)")
    parser.add_argument("--json", action="store_true", help="Print result as JSON")
    args = parser.parse_args()

    try:
        res = build_conformers(args.sequence, args.output_dir, chain=args.chain)
        if args.json:
            print(json.dumps(res))
        else:
            print(f"Generated 3 conformers and ensemble in {args.output_dir}:")
            print(f"  - Helix:    {res['conformers']['helix']}")
            print(f"  - Sheet:    {res['conformers']['sheet']}")
            print(f"  - PPII:     {res['conformers']['ppii']}")
            print(f"  - Ensemble: {res['conformers']['ensemble']}")
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()