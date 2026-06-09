import { Pressable, StyleSheet, Text } from 'react-native';
import { fonts } from '@/constants/fonts';
import { colors } from '@/constants/colors';

type Props = {
  label: string;
  onPress: () => void;
};

export function OutlineButton({ label, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    backgroundColor: colors.mistWhite,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label: {
    color: colors.inkBlack,
    fontFamily: fonts.semiBold,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
  },
});
