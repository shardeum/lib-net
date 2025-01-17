use std::{fmt::Debug, iter::Sum};
#[cfg(debug)]
use log::info;

pub(crate) struct RingBuffer<T> {
    index: usize,
    size: usize,
    buffer: Vec<T>,
    long_term_max: Option<T>,
    long_term_min: Option<T>,
}

impl<T> RingBuffer<T> {
    pub(crate) fn new(size: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(size),
            long_term_max: None,
            long_term_min: None,
            index: 0,
            size,
        }
    }

    pub(crate) fn put(&mut self, value: T)
    where
        T: Ord + Copy,
    {
        if self.index == self.size {
            self.index = 0;
        }

        if self.index == self.buffer.len() {
            self.buffer.push(value);
        } else {
            self.buffer[self.index] = value;
        }

        self.index += 1;

        let new_max = (*self.long_term_max.get_or_insert(value)).max(value);
        self.long_term_max = Some(new_max);

        let new_min = (*self.long_term_min.get_or_insert(value)).min(value);
        self.long_term_min = Some(new_min);
    }

    pub(crate) fn get_stats(&mut self) -> Stats<T>
    where
        T: Default + Copy + Ord + Sum<T> + Debug,
    {
        #[cfg(debug)]
        info!("{:?}", self.buffer);

        let total = self.buffer.iter().cloned().sum::<T>();
        let count = self.buffer.len();

        Stats {
            long_term_max: self.long_term_max.unwrap_or_default(),
            long_term_min: self.long_term_min.unwrap_or_default(),
            min: self.buffer.iter().min().cloned().unwrap_or_default(),
            max: self.buffer.iter().max().cloned().unwrap_or_default(),
            total,
            count,
        }
    }
}

pub(crate) struct Stats<T> {
    pub(crate) long_term_max: T,
    pub(crate) long_term_min: T,
    pub(crate) min: T,
    pub(crate) max: T,
    pub(crate) total: T,
    pub(crate) count: usize,
}
