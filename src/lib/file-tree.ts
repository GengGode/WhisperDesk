import type { AudioFile } from "@/lib/types";

export interface FolderNode {
  name: string;
  fullPath: string;
  children: FolderNode[];
  files: AudioFile[];
  totalFiles: number;
}

/**
 * 从文件列表构建文件夹树。
 * 自动剥离最长公共前缀，避免展示无意义的根层级。
 */
export function buildFileTree(files: AudioFile[]): FolderNode {
  if (files.length === 0) {
    return { name: "", fullPath: "", children: [], files: [], totalFiles: 0 };
  }

  const dirs = files.map((f) => parentDir(f.path));
  const prefix = longestCommonPrefix(dirs);

  const root: FolderNode = {
    name: prefix ? lastSegment(prefix) : "",
    fullPath: prefix,
    children: [],
    files: [],
    totalFiles: 0,
  };

  const nodeMap = new Map<string, FolderNode>();
  nodeMap.set(prefix, root);

  for (const file of files) {
    const dir = parentDir(file.path);
    const node = ensureNode(nodeMap, root, prefix, dir);
    node.files.push(file);
  }

  computeTotals(root);
  return collapseTree(root);
}

/** Windows / Unix 路径统一用 `/` 再处理 */
function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function parentDir(filePath: string): string {
  const norm = normalize(filePath);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

function lastSegment(dirPath: string): string {
  const norm = normalize(dirPath);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function longestCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const parts = paths.map((p) => normalize(p).split("/"));
  const first = parts[0];
  let depth = 0;
  for (let i = 0; i < first.length; i++) {
    if (parts.every((p) => p[i] === first[i])) {
      depth = i + 1;
    } else {
      break;
    }
  }
  return first.slice(0, depth).join("/");
}

function ensureNode(
  map: Map<string, FolderNode>,
  root: FolderNode,
  prefix: string,
  dir: string,
): FolderNode {
  const norm = normalize(dir);
  const existing = map.get(norm);
  if (existing) return existing;

  const parent = parentDir(norm);
  const parentNode =
    parent.length >= prefix.length
      ? ensureNode(map, root, prefix, parent)
      : root;

  const node: FolderNode = {
    name: lastSegment(norm),
    fullPath: norm,
    children: [],
    files: [],
    totalFiles: 0,
  };
  parentNode.children.push(node);
  map.set(norm, node);
  return node;
}

function computeTotals(node: FolderNode): number {
  let count = node.files.length;
  for (const child of node.children) {
    count += computeTotals(child);
  }
  node.totalFiles = count;
  return count;
}

/**
 * 折叠只有单个子文件夹且自身无文件的中间节点，
 * 避免出现无意义的单链路径层级。
 */
function collapseTree(node: FolderNode): FolderNode {
  node.children = node.children.map(collapseTree);

  if (node.children.length === 1 && node.files.length === 0) {
    const child = node.children[0];
    const merged: FolderNode = {
      ...child,
      name: node.name ? `${node.name}/${child.name}` : child.name,
    };
    return merged;
  }
  return node;
}

/** 判断树是否只有一个扁平层级（所有文件都在根下，无子文件夹） */
export function isFlat(tree: FolderNode): boolean {
  return tree.children.length === 0;
}
