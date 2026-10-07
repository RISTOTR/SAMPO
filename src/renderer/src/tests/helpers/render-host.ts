import { createRenderer } from 'vue'
export type TestNode = {
  tag: string
  props: Record<string, unknown>
  children: TestNode[]
  text: string
  parent: TestNode | null
  addEventListener: () => void
  options: TestNode[]
  value: unknown
}
export function node(tag = 'root'): TestNode {
  return {
    tag,
    props: {},
    children: [],
    text: '',
    parent: null,
    addEventListener: () => undefined,
    get options() {
      return this.children.filter((child) => child.tag === 'option')
    },
    get value() {
      return this.props.value ?? this.text
    },
    set value(value: unknown) {
      this.props.value = value
    }
  }
}
export const renderer = createRenderer<TestNode, TestNode>({
  createElement: node,
  createText: (text) => ({ ...node('text'), text }),
  createComment: (text) => ({ ...node('comment'), text }),
  setText: (target, text) => {
    target.text = text
  },
  setElementText: (target, text) => {
    target.text = text
    target.children = []
  },
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
  },
  insert: (target, parent, anchor) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
  },
  remove: (target) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = null
  },
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null
})
export function nodes(root: TestNode): TestNode[] {
  return [root, ...root.children.flatMap(nodes)]
}
