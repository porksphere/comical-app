import type { CommentNode } from '@comical/contract';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { commentPlainText } from '@/data/comments';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';

type InlineNode = Exclude<CommentNode, { type: 'quote' }>;
type TextNode = Exclude<InlineNode, { type: 'image' }>;
type Block = { kind: 'text'; nodes: TextNode[] } | { kind: 'image'; node: Extract<CommentNode, { type: 'image' }> } | { kind: 'quote'; node: Extract<CommentNode, { type: 'quote' }> };

/** A body as the blocks it is drawn in: runs of text, and the images and quotes that stand between
 *  them. A break at either end of a run is the gap the block boundary already draws. */
function blocksOf(body: readonly CommentNode[]): Block[] {
  const blocks: Block[] = [];
  let run: TextNode[] = [];
  const flush = () => {
    while (run[0]?.type === 'break') run.shift();
    while (run[run.length - 1]?.type === 'break') run.pop();
    if (run.length > 0) blocks.push({ kind: 'text', nodes: run });
    run = [];
  };
  for (const node of body) {
    if (node.type === 'image') {
      flush();
      blocks.push({ kind: 'image', node });
    } else if (node.type === 'quote') {
      flush();
      blocks.push({ kind: 'quote', node });
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

/** Past this a body is cut to `CLAMP_LINES` with "Show more". Judged by its length, since the web
 *  has no measure of how many lines a text took. */
const CLAMP_CHARS = 420;
const CLAMP_BREAKS = 7;
const CLAMP_LINES = 6;

function isLong(body: readonly CommentNode[]): boolean {
  return commentPlainText(body).length > CLAMP_CHARS || body.filter((n) => n.type === 'break').length > CLAMP_BREAKS;
}

const openLink = (url: string) => {
  if (/^https?:\/\//i.test(url)) void openBrowserAsync(url);
};

/**
 * A comment's body, drawn from its nodes with the app's own text and images: a source's markup
 * never reaches the screen. An inline spoiler is a filled bar until tapped, and one tap shows every
 * spoiler in the comment.
 */
export function CommentBody({
  body,
  commentId,
  spoilersShown,
  onShowSpoilers,
}: {
  body: readonly CommentNode[];
  commentId: string;
  spoilersShown: boolean;
  onShowSpoilers: () => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const blocks = blocksOf(body);
  const clamped = !expanded && isLong(body);
  // Clamped, the first block alone stands for the comment; the rest come with "Show more".
  const shown = clamped ? blocks.slice(0, 1) : blocks;

  const inline = (node: TextNode | Extract<CommentNode, { type: 'image' }>, key: number) => {
    switch (node.type) {
      case 'break':
        return '\n';
      case 'image':
        return (
          <Text key={key} style={{ color: theme.textSecondary }}>
            {node.alt ? `[${node.alt}]` : '[image]'}
          </Text>
        );
      case 'link':
        return (
          <Text key={key} style={{ color: theme.accent }} onPress={() => openLink(node.url)} accessibilityRole="link">
            {node.text}
          </Text>
        );
      case 'mention':
        return (
          <Text
            key={key}
            style={[styles.mention, { color: theme.accent }]}
            {...(node.url && { onPress: () => openLink(node.url!), accessibilityRole: 'link' as const })}>
            @{node.name}
          </Text>
        );
      case 'text': {
        const hidden = node.spoiler === true && !spoilersShown;
        return (
          <Text
            key={key}
            style={[
              node.bold && styles.bold,
              node.italic && styles.italic,
              node.strike && styles.strike,
              node.code && [styles.code, { backgroundColor: theme.chipBg }],
              hidden && { color: 'transparent', backgroundColor: theme.textSecondary },
              node.spoiler === true && spoilersShown && { backgroundColor: theme.chipBg },
            ]}
            {...(hidden && { onPress: onShowSpoilers, accessibilityLabel: 'Spoiler. Tap to show.', accessibilityRole: 'button' as const })}>
            {node.text}
          </Text>
        );
      }
    }
  };

  return (
    <View style={styles.body}>
      {shown.map((block, i) => {
        if (block.kind === 'image') return <CommentImage key={i} node={block.node} />;
        if (block.kind === 'quote') {
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: theme.hairline }]}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={clamped ? 2 : 6}>
                {block.node.author ? <Text style={styles.bold}>{block.node.author}: </Text> : null}
                {block.node.children.map(inline)}
              </ThemedText>
            </View>
          );
        }
        return (
          <ThemedText key={i} style={styles.text} selectable numberOfLines={clamped ? CLAMP_LINES : undefined}>
            {block.nodes.map(inline)}
          </ThemedText>
        );
      })}
      {clamped && (
        <Text
          testID={`comments.show-more.${commentId}`}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          style={[styles.more, { color: theme.accent }]}>
          Show more
        </Text>
      )}
    </View>
  );
}

const IMAGE_MAX = 200;

/** An inline image or GIF, held to a thumbnail: the comment is the subject, not the picture. */
function CommentImage({ node }: { node: Extract<CommentNode, { type: 'image' }> }) {
  const theme = useTheme();
  const uri = useResolvedAsset(node.url);
  const aspect = node.width && node.height ? node.width / node.height : 1;
  // The longer side is the cap, so a tall sticker is no bigger than a wide one.
  const width = aspect >= 1 ? IMAGE_MAX : IMAGE_MAX * aspect;
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={[styles.image, { width, aspectRatio: aspect, backgroundColor: theme.backgroundElement }]}
      contentFit="cover"
      cachePolicy="memory-disk"
      accessibilityLabel={node.alt ?? 'Image'}
    />
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: 400,
    alignSelf: 'stretch',
  },
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: Fonts?.mono, fontSize: 14 },
  mention: { fontWeight: 600 },
  quote: {
    alignSelf: 'stretch',
    borderLeftWidth: 2,
    paddingLeft: Spacing.two,
  },
  image: {
    borderRadius: 8,
  },
  more: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 600,
  },
});
