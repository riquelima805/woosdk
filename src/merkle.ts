
import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';


export function buildMerkleTree(balances: Record<string, number>) {
    const leaves = Object.entries(balances)
        .sort(([a], [b]) => a.localeCompare(b)) 
        .map(([addr, bal]) => keccak256(`${addr}:${bal}`));

    
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

    return {
        tree,
        root: tree.getRoot().toString('hex') || '0'
    };
}


export function getProof(tree: MerkleTree, address: string, balance: number) {
    const leaf = keccak256(`${address}:${balance}`);
    return tree.getProof(leaf).map((x: any) => x.data.toString('hex'));
}